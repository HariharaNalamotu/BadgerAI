use crate::*;

// ── BM25 index helpers ───────────────────────────────────────────────────────

pub(crate) fn bm25_readiness(conn: &Connection, library_name: &str) -> Result<i64, Box<dyn Error>> {
    let count = conn.query_row(
        "SELECT COUNT(*) FROM chunks_fts WHERE library_name = ?1",
        params![library_name],
        |row| row.get(0),
    )?;
    Ok(count)
}

pub(crate) fn rebuild_bm25_index_for_library(
    conn: &Connection,
    library_name: &str,
) -> Result<(), Box<dyn Error>> {
    conn.execute("DELETE FROM chunks_fts WHERE library_name=?1", params![library_name])?;
    let mut stmt = conn.prepare(
        "SELECT id, content FROM chunks WHERE library_name=?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![library_name], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (chunk_id, content) = row?;
        conn.execute(
            "INSERT INTO chunks_fts(rowid, library_name, content) VALUES (?1, ?2, ?3)",
            params![chunk_id, library_name, content],
        )?;
    }
    Ok(())
}

pub(crate) fn tokenize_fts_query(question: &str) -> String {
    let mut seen = HashSet::new();
    let terms = question
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(|term| term.to_ascii_lowercase())
        .filter(|term| seen.insert(term.clone()))
        .map(|term| format!("\"{term}\""))
        .collect::<Vec<_>>();
    terms.join(" OR ")
}

pub(crate) fn bm25_scores_for_library(
    conn: &Connection,
    library_name: &str,
    question: &str,
    limit: usize,
) -> Result<HashMap<i64, f32>, Box<dyn Error>> {
    let fts_query = tokenize_fts_query(question);
    if fts_query.is_empty() || limit == 0 { return Ok(HashMap::new()); }
    let mut stmt = conn.prepare(
        "SELECT rowid, -bm25(chunks_fts) AS score
         FROM chunks_fts WHERE chunks_fts MATCH ?1 AND library_name=?2
         ORDER BY bm25(chunks_fts) LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![fts_query, library_name, limit as i64], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, f32>(1)?))
    })?;
    let mut scores = HashMap::new();
    for row in rows {
        let (chunk_id, score) = row?;
        scores.insert(chunk_id, score);
    }
    Ok(scores)
}

pub(crate) fn normalized_scores(scores: &HashMap<i64, f32>) -> HashMap<i64, f32> {
    if scores.is_empty() { return HashMap::new(); }
    let min = scores.values().copied().fold(f32::INFINITY, f32::min);
    let max = scores.values().copied().fold(f32::NEG_INFINITY, f32::max);
    if (max - min).abs() < f32::EPSILON {
        return scores.keys().copied().map(|id| (id, 1.0)).collect();
    }
    scores.iter().map(|(id, s)| (*id, (*s - min) / (max - min))).collect()
}

// ── Scoring ──────────────────────────────────────────────────────────────────

pub(crate) fn score_chunks(
    chunks: &[ChunkRecord],
    mode: SearchMode,
    query_embedding: Option<&[f32]>,
    bm25_scores: &HashMap<i64, f32>,
    use_vector_scores: bool,
) -> Vec<ScoredChunk> {
    let vector_scores_raw: HashMap<i64, f32> = if use_vector_scores {
        chunks.iter().map(|chunk| {
            let score = match (mode, query_embedding) {
                (SearchMode::Keyword, _) => 0.0,
                (_, Some(embed)) if !chunk.embedding.is_empty() =>
                    cosine_similarity(embed, &chunk.embedding),
                _ => 0.0,
            };
            (chunk.id, score)
        }).collect()
    } else {
        HashMap::new()
    };
    let normalized_vector = normalized_scores(&vector_scores_raw);
    let normalized_bm25 = normalized_scores(bm25_scores);
    let mut scored = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        let vector_score = normalized_vector.get(&chunk.id).copied().unwrap_or(0.0);
        let bm25_score = normalized_bm25.get(&chunk.id).copied().unwrap_or(0.0);
        let final_score = match mode {
            SearchMode::Vector => vector_score,
            SearchMode::Keyword => bm25_score,
            SearchMode::Hybrid => {
                if use_vector_scores {
                    hybrid_vector_weight() * vector_score + hybrid_bm25_weight() * bm25_score
                } else {
                    bm25_score
                }
            }
        };
        scored.push(ScoredChunk {
            chunk: chunk.clone(),
            vector_score,
            bm25_score,
            final_score,
            rerank_score: 0.0,
        });
    }
    scored.sort_by(|a, b| b.final_score.partial_cmp(&a.final_score).unwrap_or(CmpOrdering::Equal));
    scored
}

// ── Query pipeline ───────────────────────────────────────────────────────────

pub(crate) fn query_library(
    conn: &Connection,
    input_name: &str,
    question: &str,
    mode: SearchMode,
    top_k: usize,
    context: usize,
    trace: bool,
    output_json: bool,
) -> Result<(), Box<dyn Error>> {
    let spinner = ProgressSpinner::new(format!("Preparing query for {}", input_name));
    let target_libraries = resolve_target_libraries(conn, input_name)?;
    let mut all_chunks = Vec::new();
    let mut all_bm25_scores = HashMap::new();
    let mut use_vector_scores = mode != SearchMode::Keyword;
    for library_name in &target_libraries {
        spinner.set_stage(format!("Checking readiness for {}", library_name));
        let (total, embedded) = embedding_readiness(conn, library_name)?;
        let bm25_count = bm25_readiness(conn, library_name)?;
        if total == 0 || bm25_count == 0 {
            spinner.finish();
            println!(
                "Library '{}' is not indexed yet. Run `plshelp chunk {}` (or `plshelp add {}`) first.",
                library_name, library_name, library_name
            );
            return Ok(());
        }
        if matches!(mode, SearchMode::Vector) && embedded < total {
            spinner.finish();
            println!(
                "Library '{}' has partial embeddings ({}/{}). Run `plshelp embed {}`.",
                library_name, embedded, total, library_name
            );
            return Ok(());
        }
        spinner.set_stage(format!("Loading chunks for {}", library_name));
        all_chunks.extend(load_chunks_for_library(conn, library_name)?);
        spinner.set_stage(format!("Loading BM25 scores for {}", library_name));
        all_bm25_scores.extend(bm25_scores_for_library(
            conn, library_name, question,
            top_k.saturating_mul(RERANK_CANDIDATE_MULTIPLIER).max(50),
        )?);
        if embedded < total { use_vector_scores = false; }
    }
    if all_chunks.is_empty() {
        spinner.finish();
        println!("No chunks indexed for '{}'.", input_name);
        return Ok(());
    }
    let effective_mode = if matches!(mode, SearchMode::Hybrid) && !use_vector_scores {
        SearchMode::Keyword
    } else {
        mode
    };
    let query_embedding = if use_vector_scores {
        spinner.set_stage("Embedding query (NV-Embed-v2)");
        embed_query(effective_mode, question)?
    } else {
        None
    };
    spinner.set_stage("Ranking candidates");
    let scored = score_chunks(
        &all_chunks, effective_mode, query_embedding.as_deref(),
        &all_bm25_scores, use_vector_scores,
    );

    // Collect rerank candidates (more than top_k to give reranker room)
    let fetch_k = top_k.saturating_mul(RERANK_CANDIDATE_MULTIPLIER).max(top_k + 10);
    let mut candidate_hits: Vec<ScoredChunk> = Vec::new();
    let mut seen_parents = HashSet::new();
    for hit in scored {
        if hit.final_score <= 0.0 { continue; }
        if seen_parents.insert(hit.chunk.parent_id) { candidate_hits.push(hit); }
        if candidate_hits.len() >= fetch_k { break; }
    }

    if candidate_hits.is_empty() {
        spinner.finish();
        emit_empty_result(input_name, question, mode, effective_mode, top_k, context, trace, output_json, &target_libraries)?;
        return Ok(());
    }

    // Load parent content for all candidates
    spinner.set_stage("Loading parent content");
    let mut candidate_parents: Vec<ParentRecord> = Vec::new();
    for hit in &candidate_hits {
        candidate_parents.push(load_parent_by_id(conn, hit.chunk.parent_id)?);
    }

    // Rerank with bge-reranker-large
    spinner.set_stage("Reranking with bge-reranker-large");
    let passages: Vec<String> = candidate_parents.iter().map(|p| p.content.clone()).collect();
    let rerank_scores = rerank_passages(question, &passages).unwrap_or_else(|_| {
        // Graceful fallback: keep initial order
        (0..passages.len()).map(|i| candidate_hits[i].final_score).collect()
    });

    // Merge rerank scores and re-sort
    let mut final_hits: Vec<(ScoredChunk, ParentRecord, f32)> = candidate_hits
        .into_iter()
        .zip(candidate_parents.into_iter())
        .zip(rerank_scores.into_iter())
        .map(|((mut hit, parent), rs)| { hit.rerank_score = rs; (hit, parent, rs) })
        .collect();
    final_hits.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(CmpOrdering::Equal));
    let top_hits: Vec<(ScoredChunk, ParentRecord)> = final_hits
        .into_iter()
        .take(top_k)
        .map(|(hit, parent, _)| (hit, parent))
        .collect();

    spinner.finish();

    let mut json_results = Vec::new();
    for (rank, (hit, parent)) in top_hits.iter().enumerate() {
        let around = if context > 0 {
            parent_neighbors(conn, &parent.library_name, &parent.source_url,
                parent.parent_index_in_page, context)?
        } else {
            Vec::new()
        };
        if output_json {
            json_results.push(query_hit_to_json(rank + 1, hit, parent, &around));
            continue;
        }
        println!("{}. [{}]", rank + 1, hit.chunk.id);
        println!("source: {}", parent.source_url);
        if target_libraries.len() > 1 { println!("   library: {}", hit.chunk.library_name); }
        if trace {
            println!(
                "   scores: rerank={:.4} final={:.4} vector={:.4} bm25={:.4}",
                hit.rerank_score, hit.final_score, hit.vector_score, hit.bm25_score
            );
            println!(
                "   child location: page_order={} parent_in_page={} child_in_parent={} global={}",
                hit.chunk.source_page_order, hit.chunk.parent_index_in_page,
                hit.chunk.child_index_in_parent, hit.chunk.global_chunk_index
            );
            println!(
                "   parent location: parent_id={} page_order={} global_parent_index={}",
                parent.id, parent.source_page_order, parent.global_parent_index
            );
            println!("   library: {}", hit.chunk.library_name);
        }
        println!("{}", parent.content);
        if context > 0 && !around.is_empty() {
            println!("--- context ---");
            for c in &around {
                if c.id != parent.id { println!("[{}] {}", c.id, c.content); }
            }
        }
        println!();
    }
    if output_json {
        print_json(&json!({
            "command": if trace { "trace" } else { "query" },
            "input_name": input_name,
            "question": question,
            "mode": mode.as_str(),
            "effective_mode": effective_mode.as_str(),
            "top_k": top_k,
            "context_window": context,
            "libraries": target_libraries,
            "results": json_results,
        }))?;
    }
    Ok(())
}

pub(crate) fn ask_libraries(
    conn: &Connection,
    question: &str,
    flags: &[String],
    output_json: bool,
) -> Result<(), Box<dyn Error>> {
    let spinner = ProgressSpinner::new("Preparing multi-library query");
    let (mode, top_k, context, filter) = ask_flags(flags)?;
    let libraries = if let Some(libs) = filter {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for lib in libs {
            for expanded in resolve_target_libraries(conn, &lib)? {
                if seen.insert(expanded.clone()) { out.push(expanded); }
            }
        }
        out
    } else {
        let mut stmt = conn.prepare("SELECT library_name FROM libraries ORDER BY library_name ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows { out.push(row?); }
        out
    };
    if libraries.is_empty() {
        spinner.finish();
        println!("No libraries indexed.");
        return Ok(());
    }
    let query_embedding = if mode != SearchMode::Keyword {
        spinner.set_stage("Embedding query (NV-Embed-v2)");
        embed_query(mode, question)?
    } else {
        None
    };

    let fetch_k = top_k.saturating_mul(RERANK_CANDIDATE_MULTIPLIER).max(top_k + 10);
    let mut combined = Vec::new();
    for lib in &libraries {
        spinner.set_stage(format!("Scoring {}", lib));
        let (total, embedded) = embedding_readiness(conn, lib)?;
        let bm25_count = bm25_readiness(conn, lib)?;
        if total == 0 || bm25_count == 0 { continue; }
        let chunks = load_chunks_for_library(conn, lib)?;
        if chunks.is_empty() { continue; }
        let bm25_scores = bm25_scores_for_library(conn, lib, question,
            fetch_k.saturating_mul(2).max(50))?;
        let library_use_vector = mode != SearchMode::Keyword && embedded == total;
        let effective_mode = if matches!(mode, SearchMode::Hybrid) && !library_use_vector {
            SearchMode::Keyword
        } else { mode };
        combined.extend(score_chunks(&chunks, effective_mode, query_embedding.as_deref(),
            &bm25_scores, library_use_vector));
    }
    combined.sort_by(|a, b| b.final_score.partial_cmp(&a.final_score).unwrap_or(CmpOrdering::Equal));

    let mut candidate_hits: Vec<ScoredChunk> = Vec::new();
    let mut seen_parents = HashSet::new();
    for hit in combined {
        if hit.final_score <= 0.0 { continue; }
        if seen_parents.insert(hit.chunk.parent_id) { candidate_hits.push(hit); }
        if candidate_hits.len() >= fetch_k { break; }
    }

    if candidate_hits.is_empty() {
        spinner.finish();
        if output_json {
            print_json(&json!({
                "command": "ask", "question": question,
                "mode": mode.as_str(), "top_k": top_k,
                "context_window": context, "libraries": [], "results": [],
            }))?;
        } else {
            println!("No results for '{}'.", question);
        }
        return Ok(());
    }

    spinner.set_stage("Loading parent content");
    let mut candidate_parents: Vec<ParentRecord> = Vec::new();
    for hit in &candidate_hits {
        candidate_parents.push(load_parent_by_id(conn, hit.chunk.parent_id)?);
    }

    spinner.set_stage("Reranking with bge-reranker-large");
    let passages: Vec<String> = candidate_parents.iter().map(|p| p.content.clone()).collect();
    let rerank_scores = rerank_passages(question, &passages).unwrap_or_else(|_| {
        (0..passages.len()).map(|i| candidate_hits[i].final_score).collect()
    });

    let mut final_hits: Vec<(ScoredChunk, ParentRecord, f32)> = candidate_hits
        .into_iter().zip(candidate_parents.into_iter()).zip(rerank_scores.into_iter())
        .map(|((mut hit, parent), rs)| { hit.rerank_score = rs; (hit, parent, rs) })
        .collect();
    final_hits.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(CmpOrdering::Equal));
    let top_hits: Vec<(ScoredChunk, ParentRecord)> = final_hits
        .into_iter().take(top_k).map(|(hit, parent, _)| (hit, parent)).collect();

    spinner.finish();

    let mut json_results = Vec::new();
    for (rank, (hit, parent)) in top_hits.iter().enumerate() {
        let around = if context > 0 {
            parent_neighbors(conn, &parent.library_name, &parent.source_url,
                parent.parent_index_in_page, context)?
        } else { Vec::new() };
        if output_json {
            json_results.push(query_hit_to_json(rank + 1, hit, parent, &around));
            continue;
        }
        println!("{}. [{}] ({})", rank + 1, hit.chunk.id, hit.chunk.library_name);
        println!("source: {}", parent.source_url);
        println!("{}", parent.content);
        if context > 0 && !around.is_empty() {
            println!("--- context ---");
            for c in &around {
                if c.id != parent.id { println!("[{}] {}", c.id, c.content); }
            }
        }
        println!();
    }
    if output_json {
        print_json(&json!({
            "command": "ask", "question": question,
            "mode": mode.as_str(), "top_k": top_k,
            "context_window": context, "results": json_results,
        }))?;
    }
    Ok(())
}

fn emit_empty_result(
    input_name: &str, question: &str, mode: SearchMode, effective_mode: SearchMode,
    top_k: usize, context: usize, trace: bool, output_json: bool,
    target_libraries: &[String],
) -> Result<(), Box<dyn Error>> {
    if output_json {
        print_json(&json!({
            "command": if trace { "trace" } else { "query" },
            "input_name": input_name, "question": question,
            "mode": mode.as_str(), "effective_mode": effective_mode.as_str(),
            "top_k": top_k, "context_window": context,
            "libraries": target_libraries, "results": [],
        }))?;
    } else {
        println!("No results for '{}'.", question);
    }
    Ok(())
}

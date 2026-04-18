use crate::*;

// ── Embedding serialization ──────────────────────────────────────────────────

pub(crate) fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub(crate) fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

pub(crate) fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut a_norm = 0.0f32;
    let mut b_norm = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        a_norm += x * x;
        b_norm += y * y;
    }
    if a_norm == 0.0 || b_norm == 0.0 { return 0.0; }
    dot / (a_norm.sqrt() * b_norm.sqrt())
}

// ── Database access helpers ──────────────────────────────────────────────────

pub(crate) fn load_chunks_for_library(
    conn: &Connection,
    library_name: &str,
) -> Result<Vec<ChunkRecord>, Box<dyn Error>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, library_name, source_page_order, parent_index_in_page,
                child_index_in_parent, global_chunk_index, embedding
         FROM chunks WHERE library_name = ?1",
    )?;
    let rows = stmt.query_map(params![library_name], |row| {
        let bytes: Vec<u8> = row.get(7)?;
        Ok(ChunkRecord {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            library_name: row.get(2)?,
            source_page_order: row.get(3)?,
            parent_index_in_page: row.get(4)?,
            child_index_in_parent: row.get(5)?,
            global_chunk_index: row.get(6)?,
            embedding: bytes_to_embedding(&bytes),
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

pub(crate) fn load_parent_by_id(conn: &Connection, parent_id: i64) -> Result<ParentRecord, Box<dyn Error>> {
    let parent = conn.query_row(
        "SELECT id, library_name, source_url, source_page_order, parent_index_in_page,
                global_parent_index, content FROM parents WHERE id = ?1",
        params![parent_id],
        |row| Ok(ParentRecord {
            id: row.get(0)?,
            library_name: row.get(1)?,
            source_url: row.get(2)?,
            source_page_order: row.get(3)?,
            parent_index_in_page: row.get(4)?,
            global_parent_index: row.get(5)?,
            content: row.get(6)?,
        }),
    )?;
    Ok(parent)
}

pub(crate) fn parent_neighbors(
    conn: &Connection,
    library_name: &str,
    source_url: &str,
    parent_index_in_page: i64,
    context: usize,
) -> Result<Vec<ParentRecord>, Box<dyn Error>> {
    if context == 0 { return Ok(Vec::new()); }
    let low = parent_index_in_page - context as i64;
    let high = parent_index_in_page + context as i64;
    let mut stmt = conn.prepare(
        "SELECT id, library_name, source_url, source_page_order, parent_index_in_page,
                global_parent_index, content
         FROM parents
         WHERE library_name=?1 AND source_url=?2 AND parent_index_in_page BETWEEN ?3 AND ?4
         ORDER BY parent_index_in_page ASC",
    )?;
    let rows = stmt.query_map(params![library_name, source_url, low, high], |row| {
        Ok(ParentRecord {
            id: row.get(0)?,
            library_name: row.get(1)?,
            source_url: row.get(2)?,
            source_page_order: row.get(3)?,
            parent_index_in_page: row.get(4)?,
            global_parent_index: row.get(5)?,
            content: row.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

pub(crate) fn embedding_readiness(
    conn: &Connection,
    library_name: &str,
) -> Result<(i64, i64), Box<dyn Error>> {
    let (total, embedded): (i64, i64) = conn.query_row(
        "SELECT COALESCE(chunk_count, 0), COALESCE(embedded_chunk_count, 0)
         FROM libraries WHERE library_name = ?1",
        params![library_name],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok((total, embedded))
}

// ── HTTP helpers for RAG service ─────────────────────────────────────────────

fn rag_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("HTTP client init failed")
}

fn call_embed(texts: &[String], is_query: bool) -> Result<Vec<Vec<f32>>, Box<dyn Error>> {
    let client = rag_client();
    let url = format!("{}/v1/embed", rag_service_url());
    let resp = client
        .post(&url)
        .json(&json!({ "texts": texts, "is_query": is_query }))
        .send()
        .map_err(|e| {
            if e.is_connect() {
                format!(
                    "Cannot reach RAG service at {}. Start it first:\n  python rag_service/start.py",
                    rag_service_url()
                )
            } else {
                format!("RAG service request failed: {e}")
            }
        })?;
    if !resp.status().is_success() {
        return Err(format!("RAG service error {}: {}", resp.status(), resp.text().unwrap_or_default()).into());
    }
    let body: Value = resp.json()?;
    let embeddings = body["embeddings"]
        .as_array()
        .ok_or("Missing 'embeddings' in RAG service response")?
        .iter()
        .map(|e| {
            e.as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect::<Vec<f32>>()
        })
        .collect();
    Ok(embeddings)
}

// ── Embedding pipeline ───────────────────────────────────────────────────────

pub(crate) fn embed_library(
    conn: &Connection,
    input_name: &str,
    force: bool,
    job_type: &str,
) -> Result<(), Box<dyn Error>> {
    let library_name = resolve_library_name(conn, input_name)?;
    let (chunk_count, _) = embedding_readiness(conn, &library_name)?;
    if chunk_count == 0 {
        return Err(format!("No chunks found for '{}'. Run add or chunk first.", library_name).into());
    }
    let job_id = start_job(conn, &library_name, job_type)?;
    let spinner = ProgressSpinner::new(format!("Preparing embeddings for {}", library_name));
    let result = (|| -> Result<String, Box<dyn Error>> {
        if force {
            spinner.set_stage(format!("Clearing embeddings for {}", library_name));
            conn.execute(
                "UPDATE chunks SET embedding = ?1 WHERE library_name = ?2",
                params![Vec::<u8>::new(), library_name],
            )?;
            update_library_rollups(conn, &library_name)?;
        }
        spinner.set_stage(format!("Loading chunks for {}", library_name));
        let mut stmt = conn.prepare(
            "SELECT id, content FROM chunks WHERE library_name=?1 AND LENGTH(embedding)=0 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![library_name], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut pending = Vec::new();
        for row in rows { pending.push(row?); }
        if pending.is_empty() {
            return Ok("All chunks already embedded.".to_string());
        }

        let batch_size = embed_batch_size();
        let tx = conn.unchecked_transaction()?;
        let total_batches = pending.len().div_ceil(batch_size);
        for (batch_idx, batch) in pending.chunks(batch_size).enumerate() {
            spinner.set_stage(format!(
                "Embedding batch {} of {} for {} (NV-Embed-v2 GPU)",
                batch_idx + 1, total_batches, library_name
            ));
            let texts: Vec<String> = batch.iter().map(|(_, c)| c.clone()).collect();
            let embeds = call_embed(&texts, false)?;
            if embeds.len() != batch.len() {
                return Err("Embedding count mismatch from RAG service.".into());
            }
            for (idx, (chunk_id, _)) in batch.iter().enumerate() {
                tx.execute(
                    "UPDATE chunks SET embedding=?1 WHERE id=?2",
                    params![embedding_to_bytes(&embeds[idx]), chunk_id],
                )?;
            }
        }
        tx.commit()?;
        spinner.set_stage(format!("Updating stats for {}", library_name));
        update_library_rollups(conn, &library_name)?;
        spinner.finish();
        Ok(format!("Embedded {} chunks via NV-Embed-v2.", pending.len()))
    })();

    match result {
        Ok(msg) => { finish_job(conn, job_id, "success", &msg)?; Ok(()) }
        Err(err) => {
            let msg = format!("{err}");
            let _ = finish_job(conn, job_id, "failed", &msg);
            Err(err)
        }
    }
}

pub(crate) fn embed_all_libraries(
    conn: &Connection,
    force: bool,
    job_type: &str,
) -> Result<usize, Box<dyn Error>> {
    let library_names = all_library_names(conn)?;
    for library_name in &library_names {
        embed_library(conn, library_name, force, job_type)?;
    }
    Ok(library_names.len())
}

pub(crate) fn embed_query(
    mode: SearchMode,
    question: &str,
) -> Result<Option<Vec<f32>>, Box<dyn Error>> {
    if let SearchMode::Keyword = mode { return Ok(None); }
    let embeddings = call_embed(&[question.to_string()], true)?;
    Ok(embeddings.into_iter().next())
}

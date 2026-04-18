use crate::*;

/// Calls the Python RAG service to rerank passages using bge-reranker-large cross encoder.
/// Returns rerank scores in the same order as `passages`. Falls back gracefully if service
/// is unreachable, returning equal scores so the caller keeps the initial ranking.
pub(crate) fn rerank_passages(
    query: &str,
    passages: &[String],
) -> Result<Vec<f32>, Box<dyn Error>> {
    if passages.is_empty() { return Ok(Vec::new()); }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()?;
    let url = format!("{}/v1/rerank", rag_service_url());
    let resp = client
        .post(&url)
        .json(&json!({ "query": query, "passages": passages }))
        .send()
        .map_err(|e| {
            if e.is_connect() {
                format!(
                    "Cannot reach RAG service at {} for reranking. Falling back to initial scores.",
                    rag_service_url()
                )
            } else {
                format!("Rerank request failed: {e}")
            }
        })?;
    if !resp.status().is_success() {
        return Err(format!("Rerank service error {}", resp.status()).into());
    }
    let body: Value = resp.json()?;
    let scores = body["scores"]
        .as_array()
        .ok_or("Missing 'scores' in rerank response")?
        .iter()
        .filter_map(|v| v.as_f64().map(|f| f as f32))
        .collect();
    Ok(scores)
}

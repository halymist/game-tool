package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	openAIResponsesURL         = "https://api.openai.com/v1/responses"
	openAIMaxAttemptsPerModel  = 3
	openAILogPreviewLimitBytes = 16000
)

func handleGenerateQuestAi(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if OPENAI_API_KEY == "" {
		http.Error(w, "OpenAI API key not configured", http.StatusInternalServerError)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	payload, normalizedBody := normalizeOpenAIPayload(body)
	body = normalizedBody

	modelsToTry := []string{""}
	if payload != nil {
		modelsToTry = modelsForOpenAIRequest(payload)
	}

	logOpenAIQuestPhaseContextPreview(payload)
	logOpenAIRequestPreview(body)

	client := &http.Client{Timeout: 300 * time.Second}
	var (
		lastStatus int
		lastBody   []byte
		lastErr    error
		usedModel  string
	)

	for modelIndex, modelName := range modelsToTry {
		for attempt := 1; attempt <= openAIMaxAttemptsPerModel; attempt++ {
			requestBody := body
			if payload != nil && strings.TrimSpace(modelName) != "" {
				payload["model"] = modelName
				updatedBody, marshalErr := json.Marshal(payload)
				if marshalErr != nil {
					log.Printf("OpenAI proxy marshal error: %v", marshalErr)
					http.Error(w, "Failed to build OpenAI request", http.StatusInternalServerError)
					return
				}
				requestBody = updatedBody
			}

			if strings.TrimSpace(modelName) == "" {
				log.Printf("OpenAI proxy: sending %d bytes (attempt=%d/%d)", len(requestBody), attempt, openAIMaxAttemptsPerModel)
			} else {
				log.Printf("OpenAI proxy: sending %d bytes (model=%s attempt=%d/%d)", len(requestBody), modelName, attempt, openAIMaxAttemptsPerModel)
			}

			statusCode, respBody, reqErr := sendOpenAIResponsesRequest(client, requestBody)
			if reqErr != nil {
				lastErr = reqErr
				log.Printf("OpenAI proxy request error (model=%s attempt=%d): %v", modelName, attempt, reqErr)
				if attempt < openAIMaxAttemptsPerModel {
					time.Sleep(openAIRetryBackoff(attempt))
					continue
				}
				break
			}

			lastStatus = statusCode
			lastBody = respBody
			lastErr = nil
			usedModel = modelName

			log.Printf("OpenAI proxy response: status=%d bytes=%d model=%s attempt=%d", statusCode, len(respBody), modelName, attempt)
			if statusCode >= 400 {
				log.Printf("OpenAI proxy error body: %s", truncateForLog(respBody, openAILogPreviewLimitBytes))
			}

			if statusCode < 400 {
				w.Header().Set("Content-Type", "application/json")
				if strings.TrimSpace(usedModel) != "" {
					w.Header().Set("X-OpenAI-Model-Used", usedModel)
				}
				w.WriteHeader(statusCode)
				_, _ = w.Write(respBody)
				return
			}

			if !shouldRetryOpenAIStatus(statusCode) {
				w.Header().Set("Content-Type", "application/json")
				if strings.TrimSpace(usedModel) != "" {
					w.Header().Set("X-OpenAI-Model-Used", usedModel)
				}
				w.WriteHeader(statusCode)
				_, _ = w.Write(respBody)
				return
			}

			if attempt < openAIMaxAttemptsPerModel {
				time.Sleep(openAIRetryBackoff(attempt))
				continue
			}

			if modelIndex < len(modelsToTry)-1 {
				log.Printf("OpenAI proxy: retries exhausted for model=%s, switching to model=%s", modelName, modelsToTry[modelIndex+1])
			}
		}
	}

	if lastStatus > 0 {
		w.Header().Set("Content-Type", "application/json")
		if strings.TrimSpace(usedModel) != "" {
			w.Header().Set("X-OpenAI-Model-Used", usedModel)
		}
		w.WriteHeader(lastStatus)
		if len(lastBody) > 0 {
			_, _ = w.Write(lastBody)
		} else {
			_, _ = w.Write([]byte(`{"error":{"message":"OpenAI upstream returned an empty error response"}}`))
		}
		return
	}

	log.Printf("OpenAI proxy failed after retries: %v", lastErr)
	http.Error(w, "OpenAI request failed after retries", http.StatusBadGateway)
}

func normalizeOpenAIPayload(rawBody []byte) (map[string]interface{}, []byte) {
	var payload map[string]interface{}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		return nil, rawBody
	}

	if _, hasInput := payload["input"]; !hasInput {
		if messages, hasMessages := payload["messages"]; hasMessages {
			payload["input"] = messages
			delete(payload, "messages")
		}
	}

	if respFormat, ok := payload["response_format"]; ok {
		payload["text"] = map[string]interface{}{
			"format": respFormat,
		}
		delete(payload, "response_format")
	}

	if model, ok := payload["model"].(string); !ok || strings.TrimSpace(model) == "" {
		payload["model"] = "o3"
	}

	updatedBody, err := json.Marshal(payload)
	if err != nil {
		return payload, rawBody
	}

	return payload, updatedBody
}

func modelsForOpenAIRequest(payload map[string]interface{}) []string {
	modelName, _ := payload["model"].(string)
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		modelName = "o3"
		payload["model"] = modelName
	}

	models := []string{modelName}
	fallbackModel := strings.TrimSpace(envOrDefault("OPENAI_FALLBACK_MODEL", "gpt-4.1"))
	if fallbackModel != "" && fallbackModel != modelName {
		models = append(models, fallbackModel)
	}
	return models
}

func sendOpenAIResponsesRequest(client *http.Client, body []byte) (int, []byte, error) {
	req, err := http.NewRequest(http.MethodPost, openAIResponsesURL, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+OPENAI_API_KEY)

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, err
	}

	return resp.StatusCode, respBody, nil
}

func shouldRetryOpenAIStatus(statusCode int) bool {
	return statusCode == http.StatusTooManyRequests || statusCode >= http.StatusInternalServerError
}

func openAIRetryBackoff(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 1200 * time.Millisecond
	case 2:
		return 2400 * time.Millisecond
	default:
		return 4 * time.Second
	}
}

func logOpenAIRequestPreview(body []byte) {
	var prettyBody bytes.Buffer
	text := string(body)
	if err := json.Indent(&prettyBody, body, "", "  "); err == nil {
		text = prettyBody.String()
	}
	log.Printf("OpenAI proxy request preview (%d bytes): %s", len(body), truncateForLog([]byte(text), openAILogPreviewLimitBytes))
}

func logOpenAIQuestPhaseContextPreview(payload map[string]interface{}) {
	phase := extractOpenAIQuestPhase(payload)
	if phase == "" {
		return
	}

	content := extractOpenAIUserContent(payload)
	preview := formatOpenAIContextPreview(content)
	if strings.TrimSpace(preview) == "" {
		log.Printf("OpenAI quest phase context: phase=%s content=<empty>", phase)
		return
	}

	log.Printf("OpenAI quest phase context: phase=%s content=%s", phase, truncateForLog([]byte(preview), openAILogPreviewLimitBytes))
}

func extractOpenAIQuestPhase(payload map[string]interface{}) string {
	if payload == nil {
		return ""
	}

	if metadata, ok := payload["metadata"].(map[string]interface{}); ok {
		for _, key := range []string{"quest_generation_phase", "questPhase", "phase"} {
			if value, ok := metadata[key]; ok {
				if text := strings.TrimSpace(asString(value)); text != "" {
					return text
				}
			}
		}
	}

	content := extractOpenAIUserContent(payload)
	switch v := content.(type) {
	case map[string]interface{}:
		if phase, ok := v["phase"]; ok {
			return strings.TrimSpace(asString(phase))
		}
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return ""
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			if phase, ok := parsed["phase"]; ok {
				return strings.TrimSpace(asString(phase))
			}
		}
	}

	return ""
}

func extractOpenAIUserContent(payload map[string]interface{}) interface{} {
	if payload == nil {
		return nil
	}

	rawInput, ok := payload["input"]
	if !ok {
		rawInput = payload["messages"]
	}

	messages, ok := rawInput.([]interface{})
	if !ok {
		return nil
	}

	for i := len(messages) - 1; i >= 0; i-- {
		msg, ok := messages[i].(map[string]interface{})
		if !ok {
			continue
		}
		role := strings.TrimSpace(asString(msg["role"]))
		if role != "user" {
			continue
		}
		if content, exists := msg["content"]; exists {
			return content
		}
	}

	return nil
}

func formatOpenAIContextPreview(content interface{}) string {
	if content == nil {
		return ""
	}

	switch v := content.(type) {
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return ""
		}
		var parsed interface{}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			if body, marshalErr := json.MarshalIndent(parsed, "", "  "); marshalErr == nil {
				return string(body)
			}
		}
		return trimmed
	case map[string]interface{}, []interface{}:
		if body, err := json.MarshalIndent(v, "", "  "); err == nil {
			return string(body)
		}
		if body, err := json.Marshal(v); err == nil {
			return string(body)
		}
		return ""
	default:
		if body, err := json.Marshal(v); err == nil {
			return string(body)
		}
		return ""
	}
}

func asString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		if body, err := json.Marshal(v); err == nil {
			return string(body)
		}
		return ""
	}
}

func truncateForLog(content []byte, limit int) string {
	if limit <= 0 || len(content) <= limit {
		return string(content)
	}
	return string(content[:limit]) + " ...[truncated]"
}

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

func handleGenerateQuestAi(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !isAuthenticated(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
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

	// Transform chat payloads into Responses API format
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err == nil {
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
		if updated, err := json.Marshal(payload); err == nil {
			body = updated
		}
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.openai.com/v1/responses", bytes.NewReader(body))
	if err != nil {
		http.Error(w, "Failed to create OpenAI request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+OPENAI_API_KEY)

	log.Printf("OpenAI proxy: sending %d bytes", len(body))
	log.Printf("Valid quest JSON template: %s", `{"chains":[{"name":"","context":"","questchain_id":1,"settlement_id":1}],"quests":[{"pos_x":0,"pos_y":0,"ending":null,"asset_id":null,"quest_id":1,"quest_name":"","sort_order":0,"start_text":"","travel_text":"","failure_text":"","default_entry":null,"questchain_id":1,"settlement_id":1,"requisite_option_id":null}],"options":[{"pos_x":0,"pos_y":0,"start":null,"enemy_id":null,"quest_id":1,"effect_id":null,"node_text":"","option_id":1,"quest_end":false,"stat_type":null,"stat_required":null,"option_text":"","reward_item":null,"reward_perk":null,"reward_potion":null,"reward_blessing":null,"reward_talent":null,"reward_stat_type":null,"reward_stat_amount":null,"reward_silver":null,"effect_amount":null,"faction_required":null,"option_effect_id":null,"option_effect_factor":null}],"requirements":[{"optionId":1,"requiredOptionId":2}]}`)
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("OpenAI proxy request error: %v", err)
		http.Error(w, "OpenAI request failed", http.StatusBadRequest)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read OpenAI response", http.StatusBadRequest)
		return
	}

	log.Printf("OpenAI proxy response: status=%d bytes=%d", resp.StatusCode, len(respBody))
	if resp.StatusCode >= 400 {
		log.Printf("OpenAI proxy error body: %s", string(respBody))
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

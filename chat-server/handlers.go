package main

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
)

// Handlers contains all HTTP handlers
type Handlers struct {
	storage *Storage
}

// NewHandlers creates a new handlers instance
func NewHandlers(storage *Storage) *Handlers {
	return &Handlers{
		storage: storage,
	}
}

// SendMessage handles POST /api/messages
func (h *Handlers) SendMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from header or query param (for now, using header)
	fromUser := r.Header.Get("X-User-ID")
	if fromUser == "" {
		h.sendError(w, "X-User-ID header is required", http.StatusBadRequest)
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.ToUser == "" {
		h.sendError(w, "to_user is required", http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		h.sendError(w, "content is required", http.StatusBadRequest)
		return
	}

	if fromUser == req.ToUser {
		h.sendError(w, "Cannot send message to yourself", http.StatusBadRequest)
		return
	}

	// Create and save message
	msg := NewMessage(fromUser, req.ToUser, req.Content)
	h.storage.SaveMessage(msg)

	// Send response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(CreateMessageResponse{
		Message:   msg,
		Success:   true,
		MessageID: msg.ID,
	})
}

// GetMessages handles GET /api/messages
func (h *Handlers) GetMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from header
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		h.sendError(w, "X-User-ID header is required", http.StatusBadRequest)
		return
	}

	messages := h.storage.GetMessagesForUser(userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GetMessagesResponse{
		Messages: messages,
		Count:    len(messages),
	})
}

// GetConversation handles GET /api/conversations/{userID}
func (h *Handlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get current user ID from header
	currentUser := r.Header.Get("X-User-ID")
	if currentUser == "" {
		h.sendError(w, "X-User-ID header is required", http.StatusBadRequest)
		return
	}

	// Get other user ID from URL
	vars := mux.Vars(r)
	otherUser := vars["userID"]
	if otherUser == "" {
		h.sendError(w, "userID is required", http.StatusBadRequest)
		return
	}

	messages := h.storage.GetMessagesInConversation(currentUser, otherUser)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GetMessagesResponse{
		Messages: messages,
		Count:    len(messages),
	})
}

// GetConversations handles GET /api/conversations
func (h *Handlers) GetConversations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get user ID from header
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		h.sendError(w, "X-User-ID header is required", http.StatusBadRequest)
		return
	}

	conversations := h.storage.GetConversationsForUser(userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GetConversationsResponse{
		Conversations: conversations,
		Count:         len(conversations),
	})
}

// HealthCheck handles GET /health
func (h *Handlers) HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "chat-server",
	})
}

// sendError sends an error response
func (h *Handlers) sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   message,
		Success: false,
	})
}

// CORS middleware
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-ID")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// loggingMiddleware logs HTTP requests
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simple logging
		next.ServeHTTP(w, r)
	})
}


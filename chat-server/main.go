package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
)

const defaultPort = "8080"

func main() {
	// Initialize storage
	storage := NewStorage()

	// Initialize handlers
	handlers := NewHandlers(storage)

	// Create router
	router := mux.NewRouter()

	// Apply middleware
	router.Use(corsMiddleware)
	router.Use(loggingMiddleware)

	// Health check endpoint
	router.HandleFunc("/health", handlers.HealthCheck).Methods("GET")

	// API routes
	api := router.PathPrefix("/api").Subrouter()
	api.HandleFunc("/messages", handlers.SendMessage).Methods("POST")
	api.HandleFunc("/messages", handlers.GetMessages).Methods("GET")
	api.HandleFunc("/conversations", handlers.GetConversations).Methods("GET")
	api.HandleFunc("/conversations/{userID}", handlers.GetConversation).Methods("GET")

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	// Start server
	addr := fmt.Sprintf(":%s", port)
	fmt.Printf("🚀 Chat server starting on port %s\n", port)
	fmt.Printf("📡 Health check: http://localhost:%s/health\n", port)
	fmt.Printf("💬 API endpoints:\n")
	fmt.Printf("   POST   http://localhost:%s/api/messages\n", port)
	fmt.Printf("   GET    http://localhost:%s/api/messages\n", port)
	fmt.Printf("   GET    http://localhost:%s/api/conversations\n", port)
	fmt.Printf("   GET    http://localhost:%s/api/conversations/{userID}\n", port)
	fmt.Printf("\n")

	log.Fatal(http.ListenAndServe(addr, router))
}


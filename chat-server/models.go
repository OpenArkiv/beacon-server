package main

import (
	"time"

	"github.com/google/uuid"
)

// Message represents a direct message between two users
type Message struct {
	ID        string    `json:"id"`
	FromUser  string    `json:"from_user"`
	ToUser    string    `json:"to_user"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
}

// Conversation represents a conversation between two users
type Conversation struct {
	ID        string    `json:"id"`
	User1     string    `json:"user1"`
	User2     string    `json:"user2"`
	Messages  []Message `json:"messages"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SendMessageRequest represents the request body for sending a message
type SendMessageRequest struct {
	ToUser  string `json:"to_user"`
	Content string `json:"content"`
}

// CreateMessageResponse represents the response after creating a message
type CreateMessageResponse struct {
	Message   Message `json:"message"`
	Success   bool    `json:"success"`
	MessageID string  `json:"message_id"`
}

// GetMessagesResponse represents the response for getting messages
type GetMessagesResponse struct {
	Messages []Message `json:"messages"`
	Count    int       `json:"count"`
}

// GetConversationsResponse represents the response for getting conversations
type GetConversationsResponse struct {
	Conversations []Conversation `json:"conversations"`
	Count         int            `json:"count"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Success bool   `json:"success"`
}

// NewMessage creates a new message
func NewMessage(fromUser, toUser, content string) Message {
	return Message{
		ID:        uuid.New().String(),
		FromUser:  fromUser,
		ToUser:    toUser,
		Content:   content,
		Timestamp: time.Now(),
	}
}

// GetConversationID generates a consistent conversation ID for two users
func GetConversationID(user1, user2 string) string {
	// Sort users alphabetically to ensure consistent conversation ID
	if user1 > user2 {
		user1, user2 = user2, user1
	}
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(user1+user2)).String()
}


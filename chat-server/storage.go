package main

import (
	"sort"
	"sync"
	"time"
)

// Storage handles in-memory storage for messages and conversations
type Storage struct {
	mu            sync.RWMutex
	messages      map[string]Message              // messageID -> Message
	conversations map[string]*Conversation         // conversationID -> Conversation
	userMessages  map[string][]string              // userID -> []messageID
}

// NewStorage creates a new storage instance
func NewStorage() *Storage {
	return &Storage{
		messages:      make(map[string]Message),
		conversations: make(map[string]*Conversation),
		userMessages:  make(map[string][]string),
	}
}

// SaveMessage saves a message to storage
func (s *Storage) SaveMessage(msg Message) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.messages[msg.ID] = msg

	// Add to user's message list
	s.userMessages[msg.FromUser] = append(s.userMessages[msg.FromUser], msg.ID)
	s.userMessages[msg.ToUser] = append(s.userMessages[msg.ToUser], msg.ID)

	// Update or create conversation
	convID := GetConversationID(msg.FromUser, msg.ToUser)
	conv, exists := s.conversations[convID]
	if !exists {
		conv = &Conversation{
			ID:        convID,
			User1:     msg.FromUser,
			User2:     msg.ToUser,
			Messages:  []Message{},
			UpdatedAt: time.Now(),
		}
		s.conversations[convID] = conv
	}

	conv.Messages = append(conv.Messages, msg)
	conv.UpdatedAt = time.Now()
}

// GetMessagesForUser gets all messages for a specific user
func (s *Storage) GetMessagesForUser(userID string) []Message {
	s.mu.RLock()
	defer s.mu.RUnlock()

	messageIDs := s.userMessages[userID]
	messages := make([]Message, 0, len(messageIDs))

	for _, msgID := range messageIDs {
		if msg, exists := s.messages[msgID]; exists {
			messages = append(messages, msg)
		}
	}

	// Sort by timestamp (newest first)
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].Timestamp.After(messages[j].Timestamp)
	})

	return messages
}

// GetConversation gets a conversation between two users
func (s *Storage) GetConversation(user1, user2 string) *Conversation {
	s.mu.RLock()
	defer s.mu.RUnlock()

	convID := GetConversationID(user1, user2)
	return s.conversations[convID]
}

// GetConversationsForUser gets all conversations for a specific user
func (s *Storage) GetConversationsForUser(userID string) []Conversation {
	s.mu.RLock()
	defer s.mu.RUnlock()

	conversations := make([]Conversation, 0)

	for _, conv := range s.conversations {
		if conv.User1 == userID || conv.User2 == userID {
			// Sort messages by timestamp (oldest first for conversation view)
			messages := make([]Message, len(conv.Messages))
			copy(messages, conv.Messages)
			sort.Slice(messages, func(i, j int) bool {
				return messages[i].Timestamp.Before(messages[j].Timestamp)
			})
			convCopy := *conv
			convCopy.Messages = messages
			conversations = append(conversations, convCopy)
		}
	}

	// Sort conversations by updated time (newest first)
	sort.Slice(conversations, func(i, j int) bool {
		return conversations[i].UpdatedAt.After(conversations[j].UpdatedAt)
	})

	return conversations
}

// GetMessagesInConversation gets all messages in a conversation between two users
func (s *Storage) GetMessagesInConversation(user1, user2 string) []Message {
	s.mu.RLock()
	defer s.mu.RUnlock()

	convID := GetConversationID(user1, user2)
	conv, exists := s.conversations[convID]
	if !exists {
		return []Message{}
	}

	// Sort messages by timestamp (oldest first)
	messages := make([]Message, len(conv.Messages))
	copy(messages, conv.Messages)
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].Timestamp.Before(messages[j].Timestamp)
	})

	return messages
}


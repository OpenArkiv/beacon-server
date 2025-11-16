# Chat Server - Direct Messaging REST API

A simple Go REST API server for direct messaging (DM) functionality. This is a basic implementation that will later be integrated with the xx-network for privacy-preserving messaging.

## Features

- Send direct messages between users
- Retrieve all messages for a user
- Get conversations between two users
- Get all conversations for a user
- In-memory storage (can be replaced with a database later)
- CORS support
- Health check endpoint

## API Endpoints

### Health Check
```
GET /health
```
Returns server status.

**Response:**
```json
{
  "status": "ok",
  "service": "chat-server"
}
```

### Send Message
```
POST /api/messages
```
Send a direct message to another user.

**Headers:**
- `X-User-ID`: The ID of the user sending the message (required)
- `Content-Type: application/json`

**Request Body:**
```json
{
  "to_user": "bob",
  "content": "Hello Bob! How are you?"
}
```

**Response (201 Created):**
```json
{
  "message": {
    "id": "uuid",
    "from_user": "alice",
    "to_user": "bob",
    "content": "Hello Bob! How are you?",
    "timestamp": "2025-11-15T20:52:16.076737-03:00"
  },
  "success": true,
  "message_id": "uuid"
}
```

### Get Messages
```
GET /api/messages
```
Get all messages for the current user (both sent and received).

**Headers:**
- `X-User-ID`: The ID of the user (required)

**Response (200 OK):**
```json
{
  "messages": [
    {
      "id": "uuid",
      "from_user": "alice",
      "to_user": "bob",
      "content": "Hello Bob!",
      "timestamp": "2025-11-15T20:52:16.076737-03:00"
    }
  ],
  "count": 1
}
```

### Get Conversation
```
GET /api/conversations/{userID}
```
Get all messages in a conversation between the current user and another user.

**Headers:**
- `X-User-ID`: The ID of the current user (required)

**Path Parameters:**
- `userID`: The ID of the other user in the conversation

**Response (200 OK):**
```json
{
  "messages": [
    {
      "id": "uuid",
      "from_user": "alice",
      "to_user": "bob",
      "content": "Hello Bob!",
      "timestamp": "2025-11-15T20:52:16.076737-03:00"
    }
  ],
  "count": 1
}
```

### Get All Conversations
```
GET /api/conversations
```
Get all conversations for the current user.

**Headers:**
- `X-User-ID`: The ID of the user (required)

**Response (200 OK):**
```json
{
  "conversations": [
    {
      "id": "conversation-uuid",
      "user1": "alice",
      "user2": "bob",
      "messages": [
        {
          "id": "uuid",
          "from_user": "alice",
          "to_user": "bob",
          "content": "Hello Bob!",
          "timestamp": "2025-11-15T20:52:16.076737-03:00"
        }
      ],
      "updated_at": "2025-11-15T20:52:16.076737-03:00"
    }
  ],
  "count": 1
}
```

## Running the Server

### Prerequisites
- Go 1.21 or later

### Build and Run

```bash
# Install dependencies
go mod tidy

# Build the server
go build -o chat-server .

# Run the server (default port 8080)
./chat-server

# Or run directly with go
go run .
```

### Environment Variables

- `PORT`: Server port (default: 8080)

```bash
PORT=3000 ./chat-server
```

## Testing

A test script is included to verify all endpoints work correctly:

```bash
# Make sure the server is running first
./chat-server

# In another terminal, run the tests
./test.sh
```

The test script will:
1. Check server health
2. Send messages between users
3. Retrieve messages and conversations
4. Test error handling

## Project Structure

```
chat-server/
├── main.go          # Server entry point and routing
├── handlers.go      # HTTP request handlers
├── models.go        # Data models (Message, Conversation, etc.)
├── storage.go       # In-memory storage implementation
├── go.mod           # Go module dependencies
├── test.sh          # Test script
└── README.md        # This file
```

## Future Enhancements

- [ ] Database persistence (PostgreSQL, SQLite, etc.)
- [ ] Authentication and authorization
- [ ] Message encryption
- [ ] Integration with xx-network for privacy-preserving messaging
- [ ] WebSocket support for real-time messaging
- [ ] Message read receipts
- [ ] File attachments
- [ ] Message search
- [ ] Pagination for large message lists

## License

This is part of the OpenArkiv project.
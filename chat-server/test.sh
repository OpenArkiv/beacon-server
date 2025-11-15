#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:8080"
USER1="alice"
USER2="bob"

echo "🧪 Testing Chat Server API"
echo "=========================="
echo ""

# Test 1: Health check
echo "1️⃣  Testing health check..."
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    echo "   Response: $body"
else
    echo -e "${RED}❌ Health check failed (HTTP $http_code)${NC}"
    exit 1
fi
echo ""

# Test 2: Send message from Alice to Bob
echo "2️⃣  Sending message from $USER1 to $USER2..."
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -H "X-User-ID: $USER1" \
    -d '{"to_user": "'"$USER2"'", "content": "Hello Bob! How are you?"}')
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 201 ]; then
    echo -e "${GREEN}✅ Message sent successfully${NC}"
    echo "   Response: $body"
    MESSAGE1_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
else
    echo -e "${RED}❌ Failed to send message (HTTP $http_code)${NC}"
    echo "   Response: $body"
    exit 1
fi
echo ""

# Test 3: Send message from Bob to Alice
echo "3️⃣  Sending message from $USER2 to $USER1..."
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -H "X-User-ID: $USER2" \
    -d '{"to_user": "'"$USER1"'", "content": "Hi Alice! I am doing great, thanks!"}')
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 201 ]; then
    echo -e "${GREEN}✅ Message sent successfully${NC}"
    echo "   Response: $body"
    MESSAGE2_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
else
    echo -e "${RED}❌ Failed to send message (HTTP $http_code)${NC}"
    echo "   Response: $body"
    exit 1
fi
echo ""

# Test 4: Send another message from Alice
echo "4️⃣  Sending another message from $USER1 to $USER2..."
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -H "X-User-ID: $USER1" \
    -d '{"to_user": "'"$USER2"'", "content": "That is wonderful to hear!"}')
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 201 ]; then
    echo -e "${GREEN}✅ Message sent successfully${NC}"
    echo "   Response: $body"
else
    echo -e "${RED}❌ Failed to send message (HTTP $http_code)${NC}"
    echo "   Response: $body"
    exit 1
fi
echo ""

# Test 5: Get all messages for Alice
echo "5️⃣  Getting all messages for $USER1..."
response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/messages" \
    -H "X-User-ID: $USER1")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
    echo -e "${GREEN}✅ Retrieved messages successfully${NC}"
    MESSAGE_COUNT=$(echo "$body" | grep -o '"count":[0-9]*' | cut -d':' -f2)
    echo "   Message count: $MESSAGE_COUNT"
    if [ "$MESSAGE_COUNT" -ge 2 ]; then
        echo -e "${GREEN}   ✅ Expected at least 2 messages${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Expected at least 2 messages, got $MESSAGE_COUNT${NC}"
    fi
else
    echo -e "${RED}❌ Failed to get messages (HTTP $http_code)${NC}"
    echo "   Response: $body"
    exit 1
fi
echo ""

# Test 6: Get conversation between Alice and Bob
echo "6️⃣  Getting conversation between $USER1 and $USER2..."
response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/conversations/$USER2" \
    -H "X-User-ID: $USER1")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
    echo -e "${GREEN}✅ Retrieved conversation successfully${NC}"
    MESSAGE_COUNT=$(echo "$body" | grep -o '"count":[0-9]*' | cut -d':' -f2)
    echo "   Message count in conversation: $MESSAGE_COUNT"
    if [ "$MESSAGE_COUNT" -ge 3 ]; then
        echo -e "${GREEN}   ✅ Expected at least 3 messages in conversation${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Expected at least 3 messages, got $MESSAGE_COUNT${NC}"
    fi
else
    echo -e "${RED}❌ Failed to get conversation (HTTP $http_code)${NC}"
    echo "   Response: $body"
    exit 1
fi
echo ""

# Test 7: Get all conversations for Alice
echo "7️⃣  Getting all conversations for $USER1..."
response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/conversations" \
    -H "X-User-ID: $USER1")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
    echo -e "${GREEN}✅ Retrieved conversations successfully${NC}"
    CONV_COUNT=$(echo "$body" | grep -o '"count":[0-9]*' | cut -d':' -f2)
    echo "   Conversation count: $CONV_COUNT"
    if [ "$CONV_COUNT" -ge 1 ]; then
        echo -e "${GREEN}   ✅ Expected at least 1 conversation${NC}"
    else
        echo -e "${YELLOW}   ⚠️  Expected at least 1 conversation, got $CONV_COUNT${NC}"
    fi
else
    echo -e "${RED}❌ Failed to get conversations (HTTP $http_code)${NC}"
    echo "   Response: $body"
    exit 1
fi
echo ""

# Test 8: Error handling - missing user ID
echo "8️⃣  Testing error handling (missing X-User-ID header)..."
response=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/messages")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 400 ]; then
    echo -e "${GREEN}✅ Error handling works correctly${NC}"
    echo "   Response: $body"
else
    echo -e "${RED}❌ Expected 400 error, got HTTP $http_code${NC}"
    echo "   Response: $body"
fi
echo ""

# Test 9: Error handling - invalid request body
echo "9️⃣  Testing error handling (invalid request body)..."
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -H "X-User-ID: $USER1" \
    -d '{"invalid": "json"}')
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 400 ]; then
    echo -e "${GREEN}✅ Error handling works correctly${NC}"
    echo "   Response: $body"
else
    echo -e "${YELLOW}⚠️  Expected 400 error, got HTTP $http_code${NC}"
    echo "   Response: $body"
fi
echo ""

echo "=========================="
echo -e "${GREEN}✅ All tests completed!${NC}"
echo ""


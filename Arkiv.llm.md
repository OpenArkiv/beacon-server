Say "Hello, World!"
Run this example in your browser that writes a single on-chain Arkiv entity - no local setup required.

const PRIVATE_KEY = '0xef638369d21bd2c8dff385e6e59e35eaf4e5f5e16e6421706d4cc670f3bfbf5b';

// 1) Connect your account to Arkiv
const walletClient = arkiv.createWalletClient({
  chain: arkiv.mendoza,
  transport: arkiv.http('https://mendoza.hoodi.arkiv.network/rpc'),
  account: privateKeyToAccount(PRIVATE_KEY),
});

const publicClient = arkiv.createPublicClient({
  chain: arkiv.mendoza,
  transport: http('https://mendoza.hoodi.arkiv.network/rpc'),
});

// 2) Write one small record on-chain
const { entityKey, txHash } = await walletClient.createEntity({
  payload: stringToPayload('Hello, Arkiv!'),
  contentType: 'text/plain',
  attributes: [{ key: 'type', value: 'hello' }],
  expiresIn: 120,
});

// 3) Read it back and decode to string
const entity = await publicClient.getEntity(entityKey);
const data = payloadToString(entity.payload);

// 4) Display results
console.log('Key:', entityKey);
console.log('Data:', data);
console.log('Tx:', txHash);


2) Voting Board

You’ve written your first entity to Arkiv - now let’s build something that feels more alive. Using the same test account and client, we’ll create a tiny Voting Board: a simple structure where people can open proposals, cast votes, and read results directly from the chain.
This part of the guide shows how a few small entities can already form a collaborative application - all powered by Arkiv.
You can keep experimenting right here in the CodePlayground, or set up the SDK locally to continue from your own environment.
1. PROPOSAL
A single entity that defines what is being decided and how long the voting stays open (expiresIn).
2. VOTES
Multiple small entities that reference the proposal by its entityKey and store each voter’s choice.
3. TALLY
A read query that fetches all votes linked to a proposal and counts them - the simplest form of an on-chain result.
Next up: we’ll create the proposal entity - the anchor for every vote that follows.


3) Open Proposal

Create the decision “room”: a proposal entity with a bounded time window (Expires In). This is where votes will attach-still using the very same client/account you verified.

Goal: Write a proposal entity with an expiration window (Expires In).
Why it matters: Gives your vote stream a clear scope and predictable cost.
Success check: You get a proposal.entityKey (the proposal ID).

```
import { stringToPayload } from '@arkiv-network/sdk/utils';

const { entityKey: proposalKey } = await walletClient.createEntity({
  payload: stringToPayload('Proposal: Switch stand-up to 9:30?'),
  contentType: 'text/plain',
  attributes: [
    { key: 'type', value: 'proposal' },
    { key: 'status', value: 'open' },
    { key: 'version', value: '1' },
  ],
  expiresIn: 200, // seconds
});
console.log('Proposal key:', proposalKey);
```

3) Open Proposal

Create the decision “room”:  a proposal entity with a bounded time window (Expires In). This is where votes will attach-still using the very same client/account you verified.

Goal: Write a proposal entity with an expiration window (Expires In).
Why it matters: Gives your vote stream a clear scope and predictable cost.
Success check: You get a proposal.entityKey (the proposal ID).

1import { stringToPayload } from '@arkiv-network/sdk/utils';
2
3const { entityKey: proposalKey } = await walletClient.createEntity({
4  payload: stringToPayload('Proposal: Switch stand-up to 9:30?'),
5  contentType: 'text/plain',
6  attributes: [
7    { key: 'type', value: 'proposal' },
8    { key: 'status', value: 'open' },
9    { key: 'version', value: '1' },
10  ],
11  expiresIn: 200, // seconds
12});
13console.log('Proposal key:', proposalKey);

4) Cast Votes

Attach votes to the proposal. Each vote is its own entity linked by proposalKey and attributed to a voter address. Same client, same journey-now with multiple actors.

Goal: Create votes with { type="vote", proposalKey, voter, choice }.
Why it matters: Votes are small, auditable facts you can query later.
Success check: Two vote keys print, both linked to your proposal.


1import { stringToPayload } from '@arkiv-network/sdk/utils';
2
3const voterAddr = walletClient.account.address;
4
5await walletClient.mutateEntities({
6  creates: [
7    {
8      payload: stringToPayload('vote: no'),
9      contentType: 'text/plain',
10      attributes: [
11        { key: 'type', value: 'vote' },
12        { key: 'proposalKey', value: proposalKey },
13        { key: 'voter', value: voterAddr },
14        { key: 'choice', value: 'no' },
15        { key: 'weight', value: '1' },
16      ],
17      expiresIn: 200,
18    },
19  ],
20});
21console.log('Votes cast for proposal:', proposalKey);

5) Batch Votes

Add many votes in one go-useful for demos, fixtures, or cross-proposal actions. You’re still operating with the same client and proposal context.

Goal: Create multiple vote entities in a single call.
Success check: Receipt count matches the number you pushed.

1import { stringToPayload } from '@arkiv-network/sdk/utils';
2
3const creates = Array.from({ length: 5 }, (_, i) => ({
4  payload: stringToPayload(`vote: yes #${i + 1}`),
5  contentType: 'text/plain',
6  attributes: [
7    { key: 'type', value: 'vote' },
8    { key: 'proposalKey', value: proposalKey },
9    { key: 'voter', value: `${voterAddr}-bot${i}` },
10    { key: 'choice', value: 'yes' },
11    { key: 'weight', value: '1' },
12  ],
13  expiresIn: 200,
14}));
15
16await walletClient.mutateEntities({ creates });
17console.log(`Batch created: ${creates.length} votes`);

6) Tally Votes

Read the chain back. Query annotated entities to compute the result. Because reads are deterministic, the same query yields the same answer.

Goal: Query votes by proposalKey and choice.
Success check: YES/NO counts match your inputs.

1const qb = publicClient.buildQuery();
2const yes = await publicClient
3  .buildQuery()
4  .where([eq("type", "vote"), eq("proposalKey", proposalKey), eq("choice", "yes")])
5  .fetch();
6
7const no = await publicClient
8  .buildQuery()
9  .where([eq("type", "vote"), eq("proposalKey", proposalKey), eq("choice", "no")])
10  .fetch();
11
12console.log(`Tallies - YES: ${yes.entities.length}, NO: ${no.entities.length}`);

7) Watch Live

Subscribe to creations and extensions in real time. No polling-just logs as the story unfolds. Keep the same client; it already knows where to listen.

Goal: Subscribe to creation and extension events for votes (and proposals).
Success check: Console logs “[Vote created] …” or “[Vote extended] …”.

1const stop = await publicClient.subscribeEntityEvents({
2  onEntityCreated: async (e) => {
3    try {
4      const ent = await publicClient.getEntity(e.entityKey);
5      const attrs = Object.fromEntries(
6        ent.attributes.map(a => [a.key, a.value])
7      );
8      const text = ent.toText();
9
10      if (attrs.type === 'vote') {
11        console.log('[Vote created]', text, 'key=', e.entityKey);
12      } else if (attrs.type === 'proposal') {
13        console.log('[Proposal created]', text, 'key=', e.entityKey);
14      }
15    } catch (err) {
16      console.error('[onEntityCreated] error:', err);
17    }
18  },
19
20  onEntityExpiresInExtended: (e) => {
21    console.log('[Extended]', e.entityKey, '→', e.newExpirationBlock);
22  },
23
24  onError: (err) => console.error('[subscribeEntityEvents] error:', err),
25});
26
27console.log('Watching for proposal/vote creations and extensions…');


8) Extend Window

Need more time to decide? Extend the proposal’s Expires In. You’re updating the same entity you opened earlier-continuing the narrative of one decision from start to finish.

Goal: Extend the proposal entity by N blocks.
Success check: Console prints the new expiration block.

1const { txHash, entityKey } = await walletClient.extendEntity({
2  entityKey: proposalKey,
3  expiresIn: 150,
4});
5console.log('Proposal extended, tx:', txHash);


Setup & Installation

If you want to run this outside the browser (CI, local ts-node, a service), set up the SDK in your own project. This section shows package.json, .env and a reference script so you can run the same Voting Board flow from your terminal.

Arkiv Testnet "Mendoza" Resources
💧 Faucet: https://mendoza.hoodi.arkiv.network/faucet/
🔍 Explorer: https://explorer.mendoza.hoodi.arkiv.network

🌐 RPC: https://mendoza.hoodi.arkiv.network/rpc
🌉 Bridge: https://mendoza.hoodi.arkiv.network/bridgette/

Installation

1# Using npm
2npm init -y
3npm i @arkiv-network/sdk dotenv tslib ethers
4
5# or with Bun
6bun init -y
7bun add @arkiv-network/sdk dotenv tslib ethers

tsconfig.json (optional)

1{
2  "compilerOptions": {
3    "target": "ES2022",
4    "module": "ESNext",
5    "moduleResolution": "Bundler",
6    "strict": true,
7    "esModuleInterop": true,
8    "skipLibCheck": true
9  },
10  "include": ["*.ts"]
11}

package.json (scripts)

1{
2  "type": "module",
3  "scripts": {
4    "start": "tsx voting-board.ts",
5    "build": "tsc",
6    "dev": "tsx watch voting-board.ts"
7  },
8  "dependencies": {
9    "@arkiv-network/sdk": "0.4.4",
10    "dotenv": "^16.4.5",
11    "tslib": "^2.8.1",
12    "ethers": "^6.13.4"
13  },
14  "devDependencies": {
15    "tsx": "^4.19.2",
16    "typescript": "^5.6.3"
17  }
18}

Environment Configuration

1# .env
2PRIVATE_KEY=0x...                      # use the (TEST) private key generated above
3RPC_URL=https://your.rpc.endpoint/rpc    # e.g. https://mendoza.hoodi.arkiv.network/rpc
4WS_URL=wss://your.rpc.endpoint/rpc/ws    # e.g. wss://mendoza.hoodi.arkiv.network/rpc/ws

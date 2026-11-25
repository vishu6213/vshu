import { describe, expect, it } from 'vitest'
import {
  buildHostProofTranscript
} from './host-proof-transcript.js'

describe('relay protocol contract', () => {
  it('locks the complete host key-possession transcript', () => {
    const transcript = buildHostProofTranscript({
      relayOrigin: 'https://relay.vshu.dev',
      relayEphemeralPublicKey: new Uint8Array(32).fill(1),
      challengeNonce: new Uint8Array(24).fill(4),
      challengeId: 'challenge-1',
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_010_000,
      userId: 'user-1',
      profileId: 'profile-1',
      organizationId: 'org-1',
      relayHostId: 'abcdefghijklmnop',
      hostPublicKey: new Uint8Array(32).fill(2),
      assignmentEpoch: 7,
      previousGeneration: 6,
      resumeRequested: true
    })
    expect(Buffer.from(transcript).toString('base64url')).toBe(
      'AAAACHByb3RvY29sAAAAGHZzaHUtcmVsYXktaG9zdC1wcm9vZi92MQAAAAd2ZXJzaW9uAAAAAQEAAAALcmVsYXlPcmlnaW4AAAAWaHR0cHM6Ly9yZWxheS52c2h1LmRldgAAABdyZWxheUVwaGVtZXJhbFB1YmxpY0tleQAAACABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAA5jaGFsbGVuZ2VOb25jZQAAABgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAALY2hhbGxlbmdlSWQAAAALY2hhbGxlbmdlLTEAAAAIaXNzdWVkQXQAAAAIAAABi8_laAAAAAAJZXhwaXJlc0F0AAAACAAAAYvP5Y8QAAAABnVzZXJJZAAAAAZ1c2VyLTEAAAAJcHJvZmlsZUlkAAAACXByb2ZpbGUtMQAAAA5vcmdhbml6YXRpb25JZAAAAAVvcmctMQAAAAtyZWxheUhvc3RJZAAAABBhYmNkZWZnaGlqa2xtbm9wAAAADWhvc3RQdWJsaWNLZXkAAAAgAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAPYXNzaWdubWVudEVwb2NoAAAACAAAAAAAAAAHAAAAEnByZXZpb3VzR2VuZXJhdGlvbgAAAAgAAAAAAAAABgAAAA9yZXN1bWVSZXF1ZXN0ZWQAAAABAQ'
    )
  })
})

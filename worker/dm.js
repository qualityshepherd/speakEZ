// Deterministic KV key for a 1:1 DM pair — same regardless of argument order
export const dmPairKey = (pk1, pk2) => `dm-pair:${[pk1, pk2].sort().join(':')}`

// Check if a pubkey is a member of a room object
export const isRoomMember = (room, pubkey) =>
  Array.isArray(room?.members) && room.members.includes(pubkey)

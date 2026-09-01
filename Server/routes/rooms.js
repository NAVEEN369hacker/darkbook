/**
 * Rooms — single hard-coded "Random" room for the basic-level prototype.
 *
 * The `roomId` on posts is a real field, so when a real room picker lands
 * later it can be swapped in here without touching posts or the feed.
 */

// "Random" is the only room at MVP. Description is what shows in the UI.
const ROOMS = [
  {
    id: 'random',
    name: 'Random',
    description: 'Everything today.',
  },
];

function handleListRooms(_req, res) {
  res.json({ rooms: ROOMS });
}

module.exports = { handleListRooms };
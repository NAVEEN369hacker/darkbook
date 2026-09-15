export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    id: 'what-is-ghostline',
    title: 'What is Ghostline?',
    excerpt: 'Discover how Ghostline is redefining social interaction.',
    date: '2026-09-01',
    content: '<p>Ghostline is a hyper-anonymous social platform that embraces the ephemeral.</p>',
  },
  {
    id: 'science-of-anonymity',
    title: 'The Science of Anonymity',
    excerpt: 'Exploring the psychological benefits of anonymous interaction.',
    date: '2026-09-03',
    content: '<p>Anonymity is a fundamental requirement for psychological safety.</p>',
  },
  {
    id: 'understanding-e2ee',
    title: 'Understanding E2EE',
    excerpt: 'A deep dive into how Ghostline ensures your messages stay private.',
    date: '2026-09-05',
    content: '<p>End-to-End Encryption means only the sender and receiver can read messages.</p>',
  },
  {
    id: 'daily-identity-rotation',
    title: 'Daily Identity Rotation',
    excerpt: 'Learn how rotating your UID protects your digital footprint.',
    date: '2026-09-07',
    content: '<p>Every UTC midnight, your identity simply vanishes.</p>',
  },
  {
    id: 'privacy-vs-anonymity',
    title: 'Privacy vs Anonymity',
    excerpt: 'Understanding the distinction between the two concepts.',
    date: '2026-09-10',
    content: '<p>Privacy is control; anonymity is the state of being unknown.</p>',
  },
  {
    id: 'persistent-social-graphs',
    title: 'The Social Graph Nightmare',
    excerpt: 'The danger of the lifelong digital archive.',
    date: '2026-09-12',
    content: '<p>The permanent record of the internet creates a culture of self-censorship.</p>',
  },
  {
    id: 'ghostline-vs-social',
    title: 'Ghostline vs Traditional Social',
    excerpt: 'Comparing the ephemeral model to the archival model.',
    date: '2026-09-13',
    content: '<p>Ghostline is built on the Flow Model, facilitating the current moment.</p>',
  },
  {
    id: 'combating-abuse',
    title: 'Combating Online Abuse',
    excerpt: 'How Ghostline balances anonymity with a safe community.',
    date: '2026-09-14',
    content: '<p>Hardware-bound moderation ensures bans stick to the physical device.</p>',
  },
  {
    id: 'future-ephemeral-web',
    title: 'The Future of the Web',
    excerpt: 'Predicting the shift towards temporary digital spaces.',
    date: '2026-09-15',
    content: '<p>The future of the web is a series of temporary sketches.</p>',
  },
  {
    id: 'digital-minimalism',
    title: 'Digital Minimalism',
    excerpt: 'How ephemeral social media reduces digital anxiety.',
    date: '2026-09-15',
    content: '<p>Stop performing for the archive and start interacting for the experience.</p>',
  }
];

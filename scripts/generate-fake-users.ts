/**
 * Generate 1,000,000 Fake Users with Diverse Personalities and Locations
 * Includes substantial Israeli representation and worldwide distribution
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Israeli cities and regions
const israeliLocations = [
  'Tel Aviv', 'Jerusalem', 'Haifa', 'Rishon LeZion', 'Petah Tikva',
  'Ashdod', 'Netanya', 'Beer Sheva', 'Holon', 'Bnei Brak',
  'Ramat Gan', 'Rehovot', 'Bat Yam', 'Ashkelon', 'Herzliya',
  'Kfar Saba', 'Modiin', 'Nazareth', 'Eilat', 'Acre'
];

// World cities with substantial representation
const worldLocations = {
  usa: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Austin'],
  uk: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Newcastle', 'Bristol', 'Sheffield', 'Edinburgh'],
  europe: ['Paris', 'Berlin', 'Madrid', 'Rome', 'Amsterdam', 'Vienna', 'Prague', 'Budapest', 'Warsaw', 'Athens'],
  asia: ['Tokyo', 'Seoul', 'Mumbai', 'Bangkok', 'Singapore', 'Beijing', 'Shanghai', 'Hong Kong', 'Manila', 'Jakarta'],
  australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'],
  africa: ['Lagos', 'Cairo', 'Johannesburg', 'Nairobi', 'Casablanca', 'Accra'],
  latinAmerica: ['Mexico City', 'São Paulo', 'Buenos Aires', 'Rio de Janeiro', 'Bogotá', 'Lima', 'Santiago', 'Caracas'],
  middleEast: ['Dubai', 'Riyadh', 'Istanbul', 'Tehran', 'Baghdad', 'Amman', 'Beirut', 'Doha'],
};

// Personality traits and archetypes
const personalities = [
  { type: 'music_nerd', traits: ['analytical', 'detailed', 'knowledgeable'], emoji: '🎵' },
  { type: 'casual_listener', traits: ['laid_back', 'friendly', 'open_minded'], emoji: '😊' },
  { type: 'audiophile', traits: ['technical', 'perfectionist', 'gear_focused'], emoji: '🎧' },
  { type: 'artist', traits: ['creative', 'expressive', 'emotional'], emoji: '🎨' },
  { type: 'producer', traits: ['technical', 'innovative', 'collaborative'], emoji: '🎛️' },
  { type: 'critic', traits: ['opinionated', 'articulate', 'harsh'], emoji: '📝' },
  { type: 'hype_beast', traits: ['trendy', 'enthusiastic', 'social'], emoji: '🔥' },
  { type: 'old_school', traits: ['nostalgic', 'traditional', 'passionate'], emoji: '📻' },
  { type: 'explorer', traits: ['curious', 'adventurous', 'diverse_taste'], emoji: '🌍' },
  { type: 'meme_lord', traits: ['humorous', 'irreverent', 'viral'], emoji: '😂' },
  { type: 'academic', traits: ['theoretical', 'scholarly', 'verbose'], emoji: '📚' },
  { type: 'troll', traits: ['contrarian', 'provocative', 'confrontational'], emoji: '😈' },
];

// Israeli-specific names (Hebrew origins)
const israeliFirstNames = [
  'David', 'Yossi', 'Aviv', 'Noam', 'Eitan', 'Roi', 'Itai', 'Yael', 'Tamar', 'Shira',
  'Noa', 'Maya', 'Adi', 'Tal', 'Or', 'Lior', 'Omri', 'Chen', 'Yuval', 'Gal',
  'Amir', 'Dan', 'Oren', 'Roni', 'Moshe', 'Sarah', 'Rachel', 'Miriam', 'Esther', 'Ruth'
];

const israeliLastNames = [
  'Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Azoulay', 'Friedman', 'Avraham', 'Katz', 'Ben-David',
  'Goldstein', 'Shapiro', 'Rothschild', 'Sharon', 'Netanyahu', 'Peres', 'Weizman', 'Rabin', 'Dayan', 'Meir'
];

// International names
const firstNames = [
  'James', 'John', 'Robert', 'Michael', 'William', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara',
  'Mohammed', 'Ahmed', 'Fatima', 'Aisha', 'Ali', 'Hassan', 'Zainab', 'Mariam',
  'Wei', 'Xiao', 'Yuki', 'Haruto', 'Sakura', 'Ravi', 'Priya', 'Arjun', 'Ananya',
  'Carlos', 'Maria', 'Jose', 'Ana', 'Luis', 'Sofia', 'Diego', 'Isabella',
  'Pierre', 'Sophie', 'Hans', 'Emma', 'Antonio', 'Giulia', 'Ivan', 'Olga'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Khan', 'Patel', 'Singh', 'Lee', 'Wang', 'Chen', 'Kim', 'Park', 'Nguyen', 'Tran',
  'Silva', 'Santos', 'Oliveira', 'Fernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor',
  'Müller', 'Schmidt', 'Schneider', 'Rossi', 'Russo', 'Ferrari', 'Ivanov', 'Petrov', 'Smirnov'
];

const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'protonmail.com', 'mail.com'];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomElements<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function generateIsraeliUser(index: number) {
  const firstName = getRandomElement(israeliFirstNames);
  const lastName = getRandomElement(israeliLastNames);
  const personality = getRandomElement(personalities);
  const location = getRandomElement(israeliLocations);
  
  const username = `${firstName.toLowerCase()}_${lastName.toLowerCase()}_${index}`.substring(0, 20);
  const email = `${username}@${getRandomElement(domains)}`;
  
  return {
    email,
    username,
    display_name: `${firstName} ${lastName}`,
    full_name: `${firstName} ${lastName}`,
    location: `${location}, Israel`,
    country: 'IL',
    bio: generateBio(personality),
    personality_type: personality.type,
    personality_traits: personality.traits,
    avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
    created_at: generateRandomDate(),
  };
}

function generateWorldUser(index: number) {
  const firstName = getRandomElement(firstNames);
  const lastName = getRandomElement(lastNames);
  const personality = getRandomElement(personalities);
  
  // Select region and city
  const regions = Object.keys(worldLocations);
  const region = getRandomElement(regions);
  const citiesInRegion = worldLocations[region as keyof typeof worldLocations];
  const location = getRandomElement(citiesInRegion);
  
  const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${index}`.substring(0, 20);
  const email = `${username}@${getRandomElement(domains)}`;
  
  const countryCode = getCountryCode(region);
  
  return {
    email,
    username,
    display_name: `${firstName} ${lastName}`,
    full_name: `${firstName} ${lastName}`,
    location: `${location}, ${getCountryName(region)}`,
    country: countryCode,
    bio: generateBio(personality),
    personality_type: personality.type,
    personality_traits: personality.traits,
    avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
    created_at: generateRandomDate(),
  };
}

function generateBio(personality: typeof personalities[0]): string {
  const bios = {
    music_nerd: [
      'Music theory enthusiast. I analyze chord progressions for fun.',
      'Deep diver into production techniques and sound design.',
      'If you can\'t explain the lydian mode, we can\'t be friends.',
    ],
    casual_listener: [
      'Just here for the vibes 🎶',
      'Music lover, not a critic. Here to discover new sounds!',
      'Open to all genres, always looking for recommendations.',
    ],
    audiophile: [
      'Tube amps > solid state. Fight me.',
      'FLAC or nothing. Currently running Sennheiser HD800s.',
      'My system cost more than my car. No regrets.',
    ],
    artist: [
      'Singer/songwriter sharing the journey.',
      'Making music, one emotion at a time.',
      'Art is the language of the soul 🎨',
    ],
    producer: [
      'Beat maker | Ableton wizard | Always collaborating',
      'FL Studio 20+ | Type beats and originals',
      'Producer looking to work with vocalists and rappers',
    ],
    critic: [
      'Saying what everyone\'s thinking but too polite to say.',
      'Music critic. High standards, honest opinions.',
      'If it\'s trash, I\'ll let you know.',
    ],
    hype_beast: [
      'First to know, first to share 🔥',
      'Trendspotter | Playlist curator | Hype distributor',
      'If it\'s not viral yet, give it 5 minutes.',
    ],
    old_school: [
      'Vinyl collector. Real music died in the 90s.',
      'They don\'t make \'em like they used to.',
      'Keeping the classics alive 📻',
    ],
    explorer: [
      'World music enthusiast | 127 countries, 1000+ genres',
      'Musical anthropologist discovering sounds from everywhere.',
      'If I haven\'t heard it, I want to.',
    ],
    meme_lord: [
      'Here for the memes and music, mostly memes tho',
      'Shitposting about music since 2015',
      '90% jokes, 10% actual music discussion',
    ],
    academic: [
      'PhD in Musicology | Researcher | Educator',
      'Studying the intersection of culture, technology, and sound.',
      'Academic by day, music lover by night.',
    ],
    troll: [
      'Playing devil\'s advocate since birth.',
      'Your favorite band is overrated.',
      'Chaos coordinator 😈',
    ],
  };
  
  const options = bios[personality.type as keyof typeof bios];
  return getRandomElement(options);
}

function getCountryCode(region: string): string {
  const codes: Record<string, string> = {
    usa: 'US',
    uk: 'GB',
    europe: 'EU',
    asia: 'AS',
    australia: 'AU',
    africa: 'AF',
    latinAmerica: 'LA',
    middleEast: 'ME',
  };
  return codes[region] || 'XX';
}

function getCountryName(region: string): string {
  const names: Record<string, string> = {
    usa: 'USA',
    uk: 'United Kingdom',
    europe: 'Europe',
    asia: 'Asia',
    australia: 'Australia',
    africa: 'Africa',
    latinAmerica: 'Latin America',
    middleEast: 'Middle East',
  };
  return names[region] || 'Earth';
}

function generateRandomDate(): string {
  // Random date within last 5 years
  const now = Date.now();
  const fiveYearsAgo = now - (5 * 365 * 24 * 60 * 60 * 1000);
  const randomTime = fiveYearsAgo + Math.random() * (now - fiveYearsAgo);
  return new Date(randomTime).toISOString();
}

async function generateUsersInBatches() {
  const TOTAL_USERS = 1_000_000;
  const BATCH_SIZE = 1000;
  const ISRAELI_PERCENTAGE = 0.15; // 15% Israeli users (150,000)
  
  console.log(`🚀 Starting generation of ${TOTAL_USERS.toLocaleString()} users...`);
  console.log(`📍 Israeli users: ${Math.floor(TOTAL_USERS * ISRAELI_PERCENTAGE).toLocaleString()} (15%)`);
  console.log(`🌍 International users: ${Math.floor(TOTAL_USERS * (1 - ISRAELI_PERCENTAGE)).toLocaleString()} (85%)`);
  
  let processedUsers = 0;
  let israeliCount = 0;
  let worldCount = 0;
  
  for (let batch = 0; batch < TOTAL_USERS / BATCH_SIZE; batch++) {
    const users = [];
    
    for (let i = 0; i < BATCH_SIZE; i++) {
      const totalIndex = batch * BATCH_SIZE + i;
      
      // Decide if this user should be Israeli
      const shouldBeIsraeli = Math.random() < ISRAELI_PERCENTAGE;
      
      if (shouldBeIsraeli) {
        users.push(generateIsraeliUser(israeliCount));
        israeliCount++;
      } else {
        users.push(generateWorldUser(worldCount));
        worldCount++;
      }
    }
    
    // Insert batch into profiles table
    const { error } = await supabase
      .from('profiles')
      .insert(users);
    
    if (error) {
      console.error(`❌ Error inserting batch ${batch}:`, error.message);
      // Continue with next batch
    } else {
      processedUsers += users.length;
      const progress = ((processedUsers / TOTAL_USERS) * 100).toFixed(2);
      console.log(`✅ Batch ${batch + 1}/${TOTAL_USERS / BATCH_SIZE} - ${processedUsers.toLocaleString()} users (${progress}%)`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('🎉 User generation complete!');
  console.log(`📊 Final stats:`);
  console.log(`   Israeli users: ${israeliCount.toLocaleString()}`);
  console.log(`   International users: ${worldCount.toLocaleString()}`);
  console.log(`   Total: ${(israeliCount + worldCount).toLocaleString()}`);
}

// Generate realistic forum activity for fake users
async function generateForumActivity() {
  console.log('🎭 Generating forum activity...');
  
  // Get all users
  const { data: users, error } = await supabase
    .from('profiles')
    .select('id, personality_type')
    .limit(10000); // Start with 10k most active users
  
  if (error || !users) {
    console.error('Failed to fetch users');
    return;
  }
  
  // Get all forums
  const { data: forums } = await supabase
    .from('forums')
    .select('id, name');
  
  if (!forums) return;
  
  console.log('Creating forum memberships...');
  
  // Each user joins 2-8 forums based on personality
  for (const user of users) {
    const forumCount = Math.floor(Math.random() * 7) + 2;
    const selectedForums = getRandomElements(forums, forumCount);
    
    const memberships = selectedForums.map(forum => ({
      forum_id: forum.id,
      user_id: user.id,
      role: Math.random() < 0.01 ? 'moderator' : 'member', // 1% moderators
    }));
    
    await supabase.from('forum_members').insert(memberships);
  }
  
  console.log('Creating posts...');
  
  // Generate posts (10-50 per user)
  for (const user of users) {
    const postCount = Math.floor(Math.random() * 40) + 10;
    
    for (let i = 0; i < postCount; i++) {
      const forum = getRandomElement(forums);
      const contentType = getRandomElement(['text', 'text', 'text', 'link', 'image']);
      
      const post = {
        forum_id: forum.id,
        user_id: user.id,
        title: generatePostTitle(user.personality_type, forum.name),
        content: generatePostContent(user.personality_type),
        content_type: contentType,
        created_at: generateRandomDate(),
      };
      
      await supabase.from('forum_posts').insert(post);
    }
    
    if (users.indexOf(user) % 100 === 0) {
      console.log(`Progress: ${users.indexOf(user)}/${users.length} users`);
    }
  }
  
  console.log('✅ Forum activity generated!');
}

function generatePostTitle(personality: string, forumName: string): string {
  const templates = {
    music_nerd: [
      `Analysis: The modal interchange in ${getRandomArtist()}'s latest track`,
      `Breaking down the chord progression in "${getRandomSong()}"`,
      `Why ${getRandomArtist()} is a genius: A technical perspective`,
    ],
    casual_listener: [
      `Just discovered ${getRandomArtist()} and I'm hooked!`,
      `What's everyone listening to today?`,
      `Looking for songs similar to "${getRandomSong()}"`,
    ],
    audiophile: [
      `Best headphones for ${forumName}? Budget: $500-1000`,
      `My new listening setup - thoughts?`,
      `Why vinyl sounds better: Change my mind`,
    ],
    hype_beast: [
      `🔥 This new ${getRandomArtist()} track is INSANE`,
      `Y'all sleeping on ${getRandomArtist()}`,
      `Hot take: ${getRandomSong()} is song of the year`,
    ],
    old_school: [
      `Remember when music was actually good?`,
      `${getRandomArtist()} could never compare to the classics`,
      `90s ${forumName} > modern ${forumName}`,
    ],
    critic: [
      `Unpopular opinion: ${getRandomArtist()} is overrated`,
      `Why "${getRandomSong()}" is actually terrible`,
      `The ${forumName} scene is dead and here's why`,
    ],
  };
  
  const options = templates[personality as keyof typeof templates] || templates.casual_listener;
  return getRandomElement(options);
}

function generatePostContent(personality: string): string {
  const length = Math.random() < 0.3 ? 'short' : 'long';
  
  if (length === 'short') {
    return `${getRandomOpinion()} What do you all think?`;
  }
  
  return `${getRandomOpinion()}\n\n${getRandomOpinion()}\n\nLet me know your thoughts in the comments!`;
}

function getRandomArtist(): string {
  const artists = ['Kendrick Lamar', 'Taylor Swift', 'The Beatles', 'Pink Floyd', 'Radiohead', 'Kanye West', 'Drake', 'Billie Eilish'];
  return getRandomElement(artists);
}

function getRandomSong(): string {
  const songs = ['Bohemian Rhapsody', 'Smells Like Teen Spirit', 'Hey Jude', 'Billie Jean', 'Wonderwall', 'Hotel California'];
  return getRandomElement(songs);
}

function getRandomOpinion(): string {
  const opinions = [
    'The production quality on this is insane.',
    'I\'ve been listening to this on repeat for days.',
    'This changed my perspective on the genre.',
    'The lyrics hit different when you really pay attention.',
    'Definitely one of the best releases this year.',
    'I don\'t understand the hype around this.',
    'The mixing could have been better.',
    'This is what real music sounds like.',
  ];
  return getRandomElement(opinions);
}

// Run the generation
if (require.main === module) {
  generateUsersInBatches()
    .then(() => generateForumActivity())
    .then(() => {
      console.log('🎊 All done!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

export { generateUsersInBatches, generateForumActivity };

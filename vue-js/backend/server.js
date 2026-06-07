const express = require('express');
const cors = require('cors');
const session = require('express-session');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. Middleware Config ---
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(session({
    secret: 'web-template-secret-key-98765',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// --- 2. MongoDB Connection ---
const DB_USER = process.env.MONGO_ROOT_USER;
const DB_PASS = process.env.MONGO_ROOT_PASS;
const DB_NAME = process.env.MONGO_DB_NAME || 'app_db';
const DB_HOST = 'db'; // Match with service name in docker-compose.yml

let dbUrl = `mongodb://${DB_HOST}:27017/${DB_NAME}`;

if (DB_USER && DB_PASS) {
    dbUrl = `mongodb://${DB_USER}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:27017/${DB_NAME}?authSource=admin`;
}

console.log(`Connecting to database at: mongodb://${DB_HOST}:27017/${DB_NAME}`);

mongoose.connect(dbUrl)
    .then(() => {
        console.log('✅ MongoDB Connected Successfully!');
        initDefaultAdmin();
    })
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err);
    });

// --- 3. Database Schemas & Models ---

// User Schema (ระบบผู้ใช้งาน)
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, // user, admin
    avatar: { type: String, default: 'avatar1' }, // avatar key: avatar1..avatar6 or custom URL
    createdAt: { type: Date, default: Date.now }
});

// Note Schema (โมเดลตัวอย่าง CRUD บันทึกโน้ต)
const noteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    createdBy: { type: String, required: true }, // username of creator
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Note = mongoose.model('Note', noteSchema);

// --- Crossword Schemas ---
const directorySchema = new mongoose.Schema({
    name: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now }
});

const crosswordWordSchema = new mongoose.Schema({
    directory: { type: String, required: true },
    word: { type: String, required: true },
    clue: { type: String, required: true },
    clue2: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const Directory = mongoose.model('Directory', directorySchema);
const CrosswordWord = mongoose.model('CrosswordWord', crosswordWordSchema);

// Ranking Schema (ระบบตารางคะแนน)
const rankingSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    playerAvatar: { type: String, default: 'avatar1' }, // avatar key or base64 data URL
    labs: [{ type: String }],
    labsKey: { type: String, required: true },
    wordCount: { type: Number, required: true },
    time: { type: Number, required: true },
    score: { type: Number, required: true },
    revealsUsed: { type: Number, default: 0 },
    useEzMode: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const Ranking = mongoose.model('Ranking', rankingSchema);

// --- 4. Helper: Create default admin if not exists ---
async function initDefaultAdmin() {
    try {
        const adminUser = process.env.ADMIN_USERNAME || 'admin';
        const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
        const exists = await User.findOne({ username: adminUser });
        
        if (!exists) {
            await User.create({
                username: adminUser,
                password: adminPass,
                role: 'admin'
            });
            console.log(`👑 Default admin created: ${adminUser} / ${adminPass}`);
        } else if (exists.password !== adminPass) {
            exists.password = adminPass;
            await exists.save();
            console.log(`👑 Default admin password updated in database to match env config`);
        }
    } catch (err) {
        console.error('Error initializing default admin:', err);
    }
}

// --- 5. API Endpoints ---

// 5.1 System Connection Status Health Check (ตรวจสอบสถานะการเชื่อมต่อ)
app.get('/api/health', (req, res) => {
    const mongoStatus = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const dbStatusText = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };

    res.json({
        success: true,
        timestamp: new Date(),
        services: {
            backend: 'running',
            database: dbStatusText[mongoStatus] || 'unknown'
        }
    });
});

// 5.2 Authentication: Register (สมัครสมาชิก)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required' });
        }

        const exists = await User.findOne({ username });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const newUser = await User.create({
            username,
            password, // In production, hash the password (e.g., using bcrypt)
            role: 'user'
        });

        res.status(201).json({ success: true, message: 'User registered successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5.3 Authentication: Login (เข้าสู่ระบบ)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required' });
        }

        const user = await User.findOne({ username, password });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid username or password' });
        }

        const userData = {
            username: user.username,
            role: user.role,
            avatar: user.avatar || 'avatar1'
        };

        // Set session
        req.session.user = userData;

        res.json({ success: true, user: userData, message: 'Logged in successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5.4 Authentication: Logout (ออกจากระบบ)
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Could not log out' });
        }
        res.clearCookie('connect.sid'); // default session cookie name
        res.json({ success: true, message: 'Logged out successfully!' });
    });
});

// 5.5 Authentication: Profile (ดึงข้อมูลผู้ล็อกอินปัจจุบัน)
app.get('/api/auth/profile', async (req, res) => {
    const envVal = process.env.ALLOW_SEED_MOCK_DATA;
    const allowSeedMockData = envVal === 'true' || envVal === 'ture';
    if (req.session.user) {
        // Re-fetch fresh avatar from DB
        try {
            const user = await User.findOne({ username: req.session.user.username });
            if (user) req.session.user.avatar = user.avatar || 'avatar1';
        } catch(e) {}
        res.json({ success: true, authenticated: true, user: req.session.user, allowSeedMockData });
    } else {
        res.json({ success: true, authenticated: false, user: null, allowSeedMockData });
    }
});

// Update Avatar
app.post('/api/auth/update-avatar', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    try {
        const { avatar } = req.body;
        if (!avatar) return res.status(400).json({ success: false, message: 'Avatar is required' });
        await User.updateOne({ username: req.session.user.username }, { avatar });
        req.session.user.avatar = avatar;
        res.json({ success: true, message: 'Avatar updated!' });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Change Password
app.post('/api/auth/change-password', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Both current and new password are required' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        const user = await User.findOne({ username: req.session.user.username, password: currentPassword });
        if (!user) return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        await User.updateOne({ username: req.session.user.username }, { password: newPassword });
        res.json({ success: true, message: 'Password changed successfully!' });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5.6 CRUD: Get All Notes (ดึงโน้ตทั้งหมด)
app.get('/api/notes', async (req, res) => {
    try {
        // Option: fetch notes belonging to logged-in user, or all notes. Let's fetch all notes for demonstration.
        const notes = await Note.find().sort({ createdAt: -1 });
        res.json({ success: true, data: notes });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5.7 CRUD: Create Note (สร้างโน้ตใหม่)
app.post('/api/notes', async (req, res) => {
    try {
        const { title, content } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'Title and content are required' });
        }

        // Get creator name (if logged in, use session, else guest)
        const creator = req.session.user ? req.session.user.username : 'Guest';

        const newNote = await Note.create({
            title,
            content,
            createdBy: creator
        });

        res.status(201).json({ success: true, data: newNote, message: 'Note created successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5.8 CRUD: Update Note (แก้ไขโน้ต)
app.put('/api/notes/:id', async (req, res) => {
    try {
        const { title, content } = req.body;
        const noteId = req.params.id;

        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'Title and content are required' });
        }

        const note = await Note.findById(noteId);
        if (!note) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        // Optional permission check: only creator or admin can edit
        if (req.session.user && req.session.user.role !== 'admin' && note.createdBy !== req.session.user.username) {
            return res.status(403).json({ success: false, message: 'Unauthorized to edit this note' });
        }

        note.title = title;
        note.content = content;
        await note.save();

        res.json({ success: true, data: note, message: 'Note updated successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5.9 CRUD: Delete Note (ลบโน้ต)
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const noteId = req.params.id;
        const note = await Note.findById(noteId);

        if (!note) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        // Optional permission check
        if (req.session.user && req.session.user.role !== 'admin' && note.createdBy !== req.session.user.username) {
            return res.status(403).json({ success: false, message: 'Unauthorized to delete this note' });
        }

        await Note.findByIdAndDelete(noteId);
        res.json({ success: true, message: 'Note deleted successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- Crossword Endpoints ---

// Helper to check if admin
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Unauthorized. Admin access required.' });
    }
};

// GET /api/crosswords/directories - Get all directories
app.get('/api/crosswords/directories', async (req, res) => {
    try {
        const dirs = await Directory.find().sort({ name: 1 });
        const dirsWithStatus = await Promise.all(dirs.map(async (d) => {
            const hasSecondLang = await CrosswordWord.exists({ directory: d.name, clue2: { $ne: '' } });
            return {
                _id: d._id,
                name: d.name,
                createdAt: d.createdAt,
                hasSecondLang: !!hasSecondLang
            };
        }));
        res.json({ success: true, data: dirsWithStatus });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/crosswords/directories - Create a new directory
app.post('/api/crosswords/directories', checkAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Directory name is required' });
        }
        const cleanedName = name.trim();
        const exists = await Directory.findOne({ name: cleanedName });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Directory already exists' });
        }
        const newDir = await Directory.create({ name: cleanedName });
        res.status(201).json({ success: true, data: newDir, message: 'Directory created successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// DELETE /api/crosswords/directories/:name - Delete a directory and all associated words
app.delete('/api/crosswords/directories/:name', checkAdmin, async (req, res) => {
    try {
        const { name } = req.params;
        const dir = await Directory.findOne({ name });
        if (!dir) {
            return res.status(404).json({ success: false, message: 'Directory not found' });
        }
        await Directory.deleteOne({ name });
        await CrosswordWord.deleteMany({ directory: name });
        res.json({ success: true, message: `Directory '${name}' and all its words deleted successfully!` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/crosswords/words - Get words in a directory
app.get('/api/crosswords/words', async (req, res) => {
    try {
        const { directory } = req.query;
        if (!directory) {
            return res.status(400).json({ success: false, message: 'Directory query param is required' });
        }
        // Support multiple directories separated by commas
        const dirs = directory.split(',');
        const words = await CrosswordWord.find({ directory: { $in: dirs } }).sort({ createdAt: 1 });
        res.json({ success: true, data: words });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/crosswords/upload - Batch upload parsed words for a directory (replaces existing words)
app.post('/api/crosswords/upload', checkAdmin, async (req, res) => {
    try {
        const { directory, words } = req.body;
        if (!directory || !words || !Array.isArray(words)) {
            return res.status(400).json({ success: false, message: 'Directory name and words array are required' });
        }
        const cleanedDir = directory.trim();
        
        // Auto-create directory if it doesn't exist yet
        let dir = await Directory.findOne({ name: cleanedDir });
        if (!dir) {
            dir = await Directory.create({ name: cleanedDir });
        }

        // Delete existing words for this directory
        await CrosswordWord.deleteMany({ directory: cleanedDir });

        // Format and insert new words
        const wordsToInsert = words
            .filter(w => w.word && w.word.trim().length > 0)
            .map(w => ({
                directory: cleanedDir,
                word: w.word.trim().toUpperCase(),
                clue: w.clue ? w.clue.trim() : 'No clue provided.',
                clue2: w.clue2 ? w.clue2.trim() : ''
            }));

        if (wordsToInsert.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid words found in the payload' });
        }

        const inserted = await CrosswordWord.insertMany(wordsToInsert);
        res.json({ 
            success: true, 
            message: `Successfully uploaded ${inserted.length} words to '${cleanedDir}'!`,
            count: inserted.length
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- Admin Dashboard Endpoints ---
app.get('/api/admin/users', checkAdmin, async (req, res) => {
    try {
        const users = await User.find({}, { password: 0 }).sort({ username: 1 });
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/scores', checkAdmin, async (req, res) => {
    try {
        // Return all rankings sorted chronologically by createdAt so we can show them round by round
        const scores = await Ranking.find({}).sort({ createdAt: 1 });
        res.json({ success: true, scores });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/seed-mock-data', checkAdmin, async (req, res) => {
    try {
        // 1. Clean existing mock data (except admin so they don't get logged out!)
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        await User.deleteMany({ username: { $ne: adminUsername } });
        await Ranking.deleteMany({});

        // 2. Mock users list
        const mockUsers = [
            { username: '6414001', password: 'password123', role: 'user', avatar: 'avatar1' },
            { username: '6414002', password: 'password123', role: 'user', avatar: 'avatar2' },
            { username: '6414003', password: 'password123', role: 'user', avatar: 'avatar3' },
            { username: '6414004', password: 'password123', role: 'user', avatar: 'avatar4' },
            { username: '6414005', password: 'password123', role: 'user', avatar: 'avatar5' },
            { username: 'somchai_s', password: 'password123', role: 'user', avatar: 'avatar6' },
            { username: 'somsri_k', password: 'password123', role: 'user', avatar: 'avatar1' },
            { username: 'student_99', password: 'password123', role: 'user', avatar: 'avatar2' },
            { username: 'crossword_pro', password: 'password123', role: 'user', avatar: 'avatar3' },
            { username: 'kitty_learner', password: 'password123', role: 'user', avatar: 'avatar4' }
        ];

        // Insert users
        await User.insertMany(mockUsers);

        // 3. Generate mock scores (Rankings) for each user
        // We want to generate chronological rounds (3 to 8 rounds per user)
        // With speeds showing growth (starting slow and getting faster)
        const mockScores = [];
        const labs = ['network_lv1', 'vocab_easy'];
        
        for (const user of mockUsers) {
            const rounds = 3 + Math.floor(Math.random() * 6); // 3 to 8 rounds
            let baseSpeed = 0.05 + Math.random() * 0.08; // starting speed: 0.05 to 0.13 w/s
            
            for (let round = 1; round <= rounds; round++) {
                // Growth rate: 10% to 25% increase each round with minor random variations
                const growth = 1.1 + (Math.random() * 0.15);
                baseSpeed = baseSpeed * growth;
                
                // Words count
                const wordCount = 10;
                // Calculate time based on speed: time = wordCount / speed
                const time = Math.round(wordCount / baseSpeed);
                const score = Number((wordCount / time).toFixed(4));
                
                // Create a chronological date for each round (e.g. 1 day apart)
                const createdAt = new Date();
                createdAt.setDate(createdAt.getDate() - (rounds - round));

                // Random reveals count (0 to 4)
                const revealsUsed = Math.floor(Math.random() * 5);

                mockScores.push({
                    playerName: user.username,
                    playerAvatar: user.avatar,
                    labs,
                    labsKey: labs.slice().sort().join('+'),
                    wordCount,
                    time,
                    score,
                    revealsUsed,
                    createdAt
                });
            }
        }

        await Ranking.insertMany(mockScores);

        res.json({ 
            success: true, 
            message: `Successfully seeded ${mockUsers.length} mock users and ${mockScores.length} rounds of performance scores!` 
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/clear-mock-data', checkAdmin, async (req, res) => {
    try {
        const mockUsernames = ['6414001', '6414002', '6414003', '6414004', '6414005', 'somchai_s', 'somsri_k', 'student_99', 'crossword_pro', 'kitty_learner'];
        await User.deleteMany({ username: { $in: mockUsernames } });
        await Ranking.deleteMany({ playerName: { $in: mockUsernames } });
        res.json({ success: true, message: 'Successfully cleared mock users and scores!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- Ranking Endpoints ---

// GET /api/rankings - Get top 50 rankings, optionally filtered by labsKey
app.get('/api/rankings', async (req, res) => {
    try {
        const { labsKey, onlySecondLang, showGuests, onlyEzMode } = req.query;
        let query = {};
        
        const isSecondLang = onlySecondLang === 'true';
        const isEzMode = onlyEzMode === 'true';
        
        if (labsKey && labsKey !== 'all') {
            // Strip any (2) or [EZ] prefix first to clean it, then append based on filters
            let cleanKey = labsKey.replace(/^\(2\)/, '').replace(/^\[EZ\]/, '');
            let finalKey = cleanKey;
            if (isSecondLang) finalKey = `(2)${finalKey}`;
            if (isEzMode) finalKey = `[EZ]${finalKey}`;
            query.labsKey = finalKey;
        } else {
            // For "All Labs" — build regex patterns
            const regexParts = [];
            if (isSecondLang && isEzMode) {
                // Must start with [EZ](2) or (2)[EZ] — we use [EZ](2) convention
                query.labsKey = { $regex: /^\[EZ\]\(2\)/ };
            } else if (isSecondLang) {
                // Must start with (2) but NOT have [EZ]
                query.labsKey = { $regex: /^(?!\[EZ\])\(2\)/ };
            } else if (isEzMode) {
                // Must start with [EZ] but NOT have (2) after it
                query.labsKey = { $regex: /^\[EZ\](?!\(2\))/ };
            } else {
                // No [EZ] and no (2) prefix
                query.labsKey = { $regex: /^(?!\[EZ\])(?!\(2\))/ };
            }
        }
        
        if (showGuests === 'false') {
            query.playerName = { $regex: /^(?!Guest_)/ };
        }
        
        const rankings = await Ranking.find(query).sort({ score: -1 }).limit(50);
        res.json({ success: true, data: rankings });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// POST /api/rankings - Submit a new score
app.post('/api/rankings', async (req, res) => {
    try {
        const { playerName, playerAvatar, labs, wordCount, time, revealsUsed, unrevealedWordCount, useSecondLang, useEzMode } = req.body;
        if (!playerName || !labs || !Array.isArray(labs) || labs.length === 0 || !wordCount || !time) {
            return res.status(400).json({ success: false, message: 'playerName, labs, wordCount, time are required' });
        }

        const scoreWords = (unrevealedWordCount !== undefined) ? Number(unrevealedWordCount) : Number(wordCount);
        const score = Number((scoreWords / time).toFixed(4));
        let labsKey = labs.slice().sort().join('+');
        if (useSecondLang) {
            labsKey = `(2)${labsKey}`;
        }
        if (useEzMode) {
            labsKey = `[EZ]${labsKey}`;
        }

        const newRanking = await Ranking.create({
            playerName: playerName.trim().substring(0, 20),
            playerAvatar: playerAvatar || 'avatar1',
            labs,
            labsKey,
            wordCount,
            time,
            score,
            revealsUsed: Number(revealsUsed) || 0,
            useEzMode: !!useEzMode
        });

        res.status(201).json({ success: true, data: newRanking, message: 'Score saved!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/my-scores - Get all scores for active player and all group scores for average calculation
app.get('/api/my-scores', async (req, res) => {
    try {
        let username = '';
        if (req.session.user) {
            username = req.session.user.username;
        } else if (req.query.playerName) {
            username = req.query.playerName;
        }
        
        let myScores = [];
        if (username) {
            myScores = await Ranking.find({ playerName: username }).sort({ createdAt: 1 });
        }
        
        // Return group scores (with essential columns only to minimize size)
        const allScores = await Ranking.find({}, { 
            playerName: 1, 
            labs: 1, 
            labsKey: 1, 
            score: 1, 
            wordCount: 1, 
            revealsUsed: 1, 
            time: 1, 
            createdAt: 1 
        }).sort({ createdAt: 1 });
        
        res.json({ success: true, myScores, allScores });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- 6. Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 NodeJS server running on port ${PORT}`);
});

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// --- 4. Helper: Create default admin if not exists ---
async function initDefaultAdmin() {
    try {
        const adminUser = 'admin';
        const adminPass = 'admin1234';
        const exists = await User.findOne({ username: adminUser });
        
        if (!exists) {
            await User.create({
                username: adminUser,
                password: adminPass,
                role: 'admin'
            });
            console.log(`👑 Default admin created: ${adminUser} / ${adminPass}`);
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
            role: user.role
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
app.get('/api/auth/profile', (req, res) => {
    if (req.session.user) {
        res.json({ success: true, authenticated: true, user: req.session.user });
    } else {
        res.json({ success: true, authenticated: false, user: null });
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

// --- 6. Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 NodeJS server running on port ${PORT}`);
});

# 🧩 Web Crossword Game

เกมอักษรไขว้ออนไลน์ พัฒนาด้วย Nginx + Node.js + MongoDB + Vue.js  
รันบน Docker Compose พร้อมใช้งานทันที

---

## 🚀 วิธีรัน

```bash
# เริ่มต้น Stack ทั้งหมด
docker-compose up --build -d

# ดู logs แบบ real-time
docker-compose logs -f

# หยุด Stack (ข้อมูลยังอยู่)
docker-compose down

# หยุด + ลบ Volume ทั้งหมด (reset ฐานข้อมูล)
docker-compose down -v
```

เมื่อรันแล้วเข้าใช้งานที่: **http://localhost:8080**

---

## 🎮 หน้าเกม (Player)

- เปิด `http://localhost:8080` — เข้าสู่หน้าเกมโดยตรง
- เลือกหมวดหมู่โจทย์และจำนวนคำ แล้วกด **เริ่มเล่นเกม**
- ลากเมาส์เพื่อเลื่อนตาราง · เลื่อนล้อเมาส์เพื่อซูม
- กดปุ่ม **คำใบ้** เพื่อดูคำใบ้ทั้งหมด (popup)
- กดปุ่ม **เฉลย** เพื่อเปิดโหมดเฉลย → ดับเบิลคลิกที่ช่องเพื่อเปิดตัวอักษร

---

## 🔐 วิธีเข้าหน้า Admin

> **Admin เข้าได้ผ่าน URL เท่านั้น — ไม่มีปุ่มสำหรับผู้ใช้ทั่วไป**

เปิด URL:

```
http://localhost:8080/#admin
```

จากนั้นล็อกอินด้วย:

| Field    | ค่า Default |
|----------|-------------|
| Username | `admin`     |
| Password | `admin1234` |

> แนะนำให้เปลี่ยนรหัสผ่านหลังจาก deploy จริง

---

## 🗂️ ฟีเจอร์ Admin

| ฟีเจอร์ | รายละเอียด |
|--------|-----------|
| **สร้าง Directory** | สร้างหมวดหมู่โจทย์ เช่น `network_lv1`, `vocab_easy` |
| **อัปโหลด CSV** | ลากไฟล์ CSV มาวาง หรือคลิกเพื่อเลือก |
| **ดูข้อมูล** | ตรวจสอบคำศัพท์ที่โหลดเข้าระบบ |
| **ลบหมวดหมู่** | ลบพร้อมคำศัพท์ทั้งหมด |

---

## 📄 รูปแบบไฟล์ CSV

ไฟล์ CSV ต้องมี **2 คอลัมน์** คั่นด้วยจุลภาค (`,`):

```
คำศัพท์,คำใบ้
switch,A device that connects multiple devices in a LAN and forwards data based on MAC addresses.
host,A computer or other device connected to a network.
server,A computer that provides services or resources to other devices (clients) over a network.
```

- **คอลัมน์ที่ 1**: คำศัพท์ (ตัวอักษรภาษาอังกฤษ ไม่มีช่องว่าง)
- **คอลัมน์ที่ 2**: คำใบ้ (ข้อความอธิบาย)
- รองรับ header row — ถ้าแถวแรกไม่ใช่คำศัพท์จะข้ามไปอัตโนมัติ
- คำที่มีความยาว < 2 ตัวอักษรจะถูกข้ามไป

### ตัวอย่างไฟล์ทดสอบ

ไฟล์ตัวอย่าง: [`test_crossword.csv`](./test_crossword.csv)

---

## 🏗️ สถาปัตยกรรม

```
┌─────────────────────────────────────────────┐
│                  Client Browser              │
└───────────────────┬─────────────────────────┘
                    │ HTTP :8080
┌───────────────────▼─────────────────────────┐
│              Nginx (Reverse Proxy)           │
│   /         → serves Vue.js static files    │
│   /api/*    → proxy to NodeJS :3000         │
└──────┬────────────────────────┬─────────────┘
       │                        │
┌──────▼──────┐        ┌────────▼────────┐
│  Vue.js SPA │        │  Express (Node) │
│  (frontend) │        │  (backend :3000)│
└─────────────┘        └────────┬────────┘
                                │ Mongoose
                       ┌────────▼────────┐
                       │    MongoDB      │
                       │   (db :27017)   │
                       └─────────────────┘
```

---

## 📦 Services

| Service   | Port (Host) | Image              |
|-----------|-------------|--------------------|
| Nginx     | 8080        | nginx:alpine       |
| NodeJS    | -           | node:18-alpine     |
| MongoDB   | 27018       | mongo:latest       |

MongoDB volume: `mongo_data` (persistent across restarts)

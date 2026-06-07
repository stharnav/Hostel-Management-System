# Hostel Management System

A web app for managing a hostel — students (with photo + ID), rooms, and
room assignments — built with **Node.js + Express** and backed by **Firebase
(Firestore + Storage)**. Images are compressed with `sharp` before they ever
hit the database/bucket.

## Features

- 🔐 **Multi-user auth** — two roles: `admin` and `staff`. Admins can
  manage other users and delete records; staff can add/edit students and
  rooms.
- 👨‍🎓 **Student management** — full CRUD with text fields plus photo and ID
  proof images. Images are auto-compressed (resized to max 800px, JPEG
  q70, EXIF-rotated) before being saved.
- 🚪 **Room management** — add rooms with type, capacity, floor, rent,
  status. Assign / unassign students with capacity checks.
- 📊 **Dashboard** — student count, room count, occupancy stats.
- 🧾 **Activity log** — every sign-in, create, edit, delete, payment, role
  change, and branding update is recorded with the actor, timestamp, and
  IP. Filter by group, action, actor, or date from `/logs`.
- ☁️ **Firebase Storage** for images, **Firestore** for data. Falls back
  to inline base64-in-Firestore if no Storage bucket is configured.

## Tech

| Layer        | Choice                                    |
|--------------|-------------------------------------------|
| Server       | Express 4, EJS views (express-ejs-layouts) |
| Database     | Firebase Firestore (firebase-admin)        |
| File storage | Firebase Storage (with fallback)           |
| Uploads      | multer (memoryStorage)                     |
| Compression  | sharp                                      |
| Auth         | express-session + bcryptjs                 |
| UI           | Bootstrap 5 + Bootstrap Icons              |

## Project layout

```
.
├── server.js                # app entry
├── config/firebase.js       # firebase-admin init
├── middleware/              # auth + upload (multer)
├── controllers/             # auth / students / rooms / users / logs …
├── routes/                  # express routers
├── utils/
│   ├── imageCompressor.js   # sharp resize+JPEG
│   ├── storage.js           # upload to Storage / fallback to base64
│   ├── permissions.js       # permission catalog + role resolution
│   ├── logger.js            # activity log writer
│   ├── appSettings.js       # branding cache
│   └── fees.js              # fee status math
├── views/                   # EJS templates
└── public/css/style.css
```

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Firebase project

1. Go to https://console.firebase.google.com and create a project.
2. Enable **Cloud Firestore** (Build → Firestore Database → Create).
3. (Recommended) Enable **Storage** (Build → Storage → Get started).
4. **Project Settings → Service accounts → Generate new private key.**
   Save the downloaded JSON as `config/serviceAccountKey.json`.

### 3. Configure env

```bash
cp .env.example .env
```

Edit `.env`:

```
PORT=3000
SESSION_SECRET=put_a_long_random_string_here
FIREBASE_SERVICE_ACCOUNT_PATH=./config/serviceAccountKey.json
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=admin123
```

> If you don't set `FIREBASE_STORAGE_BUCKET`, image uploads still work but
> are embedded as base64 inside the Firestore document. Good for demos,
> not great for production.

### 4. Run

```bash
npm run dev    # with nodemon
# or
npm start
```

Open <http://localhost:3000>. On first run the server seeds an admin user
from the `BOOTSTRAP_ADMIN_*` env vars — log in with those credentials,
then create more users from **Users → Add User**.

## Image compression

`utils/imageCompressor.js` runs every uploaded image through `sharp`:

- honors EXIF orientation (`.rotate()`)
- resizes to fit inside 800×800 (no upscale)
- re-encodes as JPEG with quality 70 (mozjpeg)

A typical 3–5 MB phone photo lands at ~80–150 KB.

## Data model

**users** — `{ name, email, passwordHash, role: 'admin'|'staff', roleId,
active, createdAt }`

**students** — `{ name, nameNepali, dob, email, phone, address,
citizenNo, institute, classTime, levelOfStudy, bloodGroup, dietary,
diseases, father: {…}, mother: {…}, localGuardian: {…}, photo: { url,
path }, idProof: { url, path }, roomId, status: 'active'|'on_leave'|
'returned'|'left', enrolledAt, lastPaidAt, payments: […], createdAt,
updatedAt }`

**rooms** — `{ roomNumber, type, capacity, floor, rent, status,
occupants: [studentId, ...], createdAt }`

**roles** — `{ key, name, description, permissions, isSystem, createdAt,
updatedAt }`

**logs** — `{ action, actor: { id, name, email, role }, entity,
entityId, summary, details, ip, userAgent, createdAt }`

## Notes

- The first user is bootstrapped only if the `users` collection is empty.
- Deleting a student frees its room slot and deletes its images from
  Storage. Deleting a room clears `roomId` on its occupants.
- Only admins can delete students, rooms, or other users.
- The **Activity Log** at `/logs` records sign-ins (and failed attempts),
  CRUD on students, rooms, users, fees, role changes, and branding
  updates. Each entry captures the actor, timestamp, target entity, and
  IP. The log is admin-only by default — grant `logs.view` to expose it
  to a non-admin role.

# SitePulse — Geofence Attendance System

Har project ki apni location + range hoti hai. Worker jab uss range me aata hai to automatic **IN**,
range se bahar jaate hi automatic **OUT** — bina QR, bina worker ke kuch kiye.

## Kaise kaam karta hai

1. **Admin panel** (ye website) me har project add karo — map par click karke location set karo, aur radius (meters) daalo.
2. Har project me worker add karo (Emp ID + naam). Worker add karte hi ek unique **Device Token** milega.
3. Worker ke phone me ek chhota Android app install hota hai (ek baar) — usme ye Device Token daal dete hain.
4. Uske baad app background me chalta rehta hai. Jaise hi worker uss project ki range me enter/exit karta hai, app khud backend ko batata hai aur attendance IN/OUT ho jaati hai — worker ko app kabhi khud se kholne ki zaroorat nahi.

## Admin login

Teen fixed admin accounts pehle se set hain — koi setup step nahi karna:

| Username | Password |
|---|---|
| `DHAVAL` | `AURA9999` |
| `ADMIN` | `Admin123` |
| `IT` | `IT@9999` |

Teeno se poora access milta hai — projects, workers, locations sab kuch. Deploy karte hi seedha in credentials se login karo.

## Naye features

- **Dashboard** — aaj ka Present / Absent / Late / Total, aur sab workers ka live IN/OUT status
- **Monthly Report** — mahine ka pie-chart breakdown, daily trend graph, aur din-wise check-in/check-out/hours table + Excel (CSV) download
- **Full History** — naam/emp ID se search, date se filter, poori history download
- **Projects** — har project ki apni location + range; "Meri Location use karo" button se current location seedha map par aa jaati hai (browser GPS permission maangega)
- **Employees** — worker list + delete

> Late ki definition: agar kisi worker ka pehla check-in **10:30 AM** ke baad hota hai to use "Late" mark kiya jaata hai. Ye time `routes/attendance.js` file me `LATE_AFTER` variable badal ke change kar sakte ho.

## Local test

```bash
npm install
npm start
```
Browser me `http://localhost:3000` kholo. Pehli baar admin username/password set karna hoga.

## GitHub par push karna

```bash
git init
git add .
git commit -m "SitePulse attendance system"
git branch -M main
git remote add origin https://github.com/<aapka-username>/<repo-name>.git
git push -u origin main
```

## Render par deploy karna

1. [render.com](https://render.com) par jaakar **New +** → **Web Service** choose karo.
2. Apna GitHub repo connect karo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Environment Variables** me ye add karo:
   - `JWT_SECRET` = koi bhi lamba random string (login token secure karne ke liye)
5. Deploy hote hi Render ek URL dega jaise `https://sitepulse.onrender.com` — yehi aapka live admin panel hai.

> **Important:** Database ek simple JSON file (`db/data.json`) me store hota hai — koi native module/compile step nahi, isliye Render par deploy 100% smooth hoga. Lekin Render ka free tier disk *ephemeral* hota hai — matlab har naye deploy (code update) par ye file reset ho sakti hai. Testing ke liye ye theek hai. Real workers ka data lambe time tak safe rakhna ho to Render ka **Persistent Disk** (paid) ya **PostgreSQL** addon use karna better rahega — jab is stage par pahunche, bata dena, migrate karna easy hai.

## Android app (agla step)

Android app ka kaam hai:
- Ek baar khulke Device Token lena (paste karke save)
- Background location permission maangna ("Allow all the time")
- Android ki **Geofencing API** se project ki location + radius register karna
- Jaise hi geofence ENTER/EXIT event aaye, seedha `POST /api/track/ping` API ko call karna:
  ```json
  { "device_token": "...", "latitude": ..., "longitude": ... }
  ```
- Uske baad app background me chup chaap chalta rahega, worker ko kabhi kholna nahi padega.

Ye alag se ek chhota Android Studio (Kotlin) project hoga jo isi backend se baat karega. Bata do jab backend live ho jaye (Render URL mil jaye), main turant Android app ka code bana deta hoon jisme wahi URL hardcoded hoga.

## API endpoints reference

| Endpoint | Method | Kaam |
|---|---|---|
| `/api/auth/setup` | POST | Pehli baar admin account banana |
| `/api/auth/login` | POST | Admin login |
| `/api/projects` | GET/POST | Projects dekhna/banana |
| `/api/projects/:id` | PUT/DELETE | Project edit/delete |
| `/api/workers` | GET/POST | Workers dekhna/add karna |
| `/api/track/ping` | POST | **Phone app yahan location bhejta hai** (no login needed, device_token se) |
| `/api/attendance/live` | GET | Sabka current IN/OUT status |
| `/api/attendance/logs` | GET | Attendance history |

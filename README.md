# The Yaari Cafe

yaari-cafe/
  website/          customer site (open index.html)
  admin/            admin panel (open index.html), login: theyaari@cafe.com
  firestore.rules   paste in Firebase > Firestore > Rules

Both folders use the same Firebase project (config is already filled in each `firebase-config.js`).
Razorpay Key ID goes only in `website/firebase-config.js`.

## Firebase setup
1. Authentication > enable Email/Password and Google.
2. Authentication > Users > add user theyaari@cafe.com / theyaaricafe#@123 (do this first).
3. Firestore Database > create, then paste firestore.rules > Publish.
4. Authentication > Settings > Authorized domains: add your website and admin domains.

## Run locally
Do not double-click the files. In each folder run `npx serve .` (or use VS Code Live Server).

## Deploy as two separate sites (Firebase Hosting)
firebase login
firebase init hosting      (once)
firebase hosting:sites:create theyaari-admin
Then in firebase.json use two targets: website/ -> theyaari, admin/ -> theyaari-admin
firebase deploy --only hosting
Add both domains to Authorized domains.

## Admin tips (new UI)
- Page content > Highlight cards: use `icon | title | text`. Icons: cup, box, leaf, card, clock, heart, star, pin, bag (or any emoji).
- Menu items > "Load sample menu" fills a starter menu you can edit.
- Razorpay Key ID: `website/firebase-config.js` (RAZORPAY_KEY_ID). Until it is set, the Pay button shows "Payments are not set up yet".

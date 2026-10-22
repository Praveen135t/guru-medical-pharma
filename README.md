# Guru Medical & Pharma Clinic

A starter full-stack shop-pickup website for Guru Medical & Pharma Clinic.

## Run in Replit
1. Create/open a Node.js Replit project.
2. Upload/extract all files from this ZIP into the project root.
3. Run `npm install`.
4. In Replit Secrets, set:
   - `ADMIN_PASSWORD` to a strong unique password
   - `SESSION_SECRET` to a long random secret
   - Optional: `SHOP_LAT` and `SHOP_LNG` for precise distance calculations
5. Run `npm start`.

Admin login: open `/admin`. Username is `admin`; password is the `ADMIN_PASSWORD` secret.
If `ADMIN_PASSWORD` is not set, the server refuses to start.

## Important before going live
- Add real product records and verify inventory, prices and expiry dates.
- This starter intentionally does NOT process real online payments. The “Online payment” option is shown as a setup-required option; configure a payment provider and verify payment signatures on the server before accepting payments.
- Prescription medicines must only be dispensed after a valid prescription is reviewed by qualified pharmacy staff, where required. Do not list prescription-only medicines for unrestricted purchase. Follow applicable Indian pharmacy, drug-sale, privacy and consumer-protection rules.
- Browser notifications require HTTPS and customer permission. The starter uses in-site order status lookup; configure a push notification provider for background alerts.
- Set the exact shop coordinates in Secrets if you want accurate customer-to-shop distance. Browser location permission is required from customers.
- Use a production session store and HTTPS for production deployment; default in-memory sessions are intended for a starter/demo.

## Features
- Public product catalogue, search, cart and shop-pickup checkout
- Pay-at-shop option
- Admin login and dashboard
- Product create/edit/delete, stock and low-stock list
- Order status management
- Persistent SQLite storage
- Server-side stock validation
- Shop open/closed indicator (24-hour schedule by default)
- Customer order tracking using order number and phone number

# Next Steps (for Future Me)

**Last session:** 2025-12-04  
**Branch:** feature/add-auth

## What I just did

- Implemented login API (`POST /api/login`)
- Added basic validation for email + password
- Started wiring frontend login form, not finished yet

## What problem I was solving

- Allow users to authenticate and get a JWT token
- Next step: protect the dashboard routes using that token

## What to do next (in order)

1. Finish login form submit handler in `Login.tsx`
2. Handle error UI for invalid credentials
3. Add auth guard in the frontend router
4. Write one test for successful login

## Open questions / decisions

- Should JWT expiry be 15 mins or 1 hour?
- Do we need refresh tokens for MVP? (leaning towards **no**)

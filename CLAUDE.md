# Chronicle - AI Assistant Guide

## Project Overview

Chronicle is a **Velocity-Based Training (VBT) web application** that enables real-time exercise tracking using only a smartphone camera. It delivers professional-grade performance metrics without expensive sensor hardware by leveraging MediaPipe for pose detection. It supports **19 exercise types** across squats, hinges, presses, and rows.

### Key Value Proposition
- Phone camera-powered exercise tracking (no sensors required)
- Real-time velocity feedback for athletes
- Objective depth measurement across multiple exercise categories
- Speed score calculations normalized across exercise types
- **Workout tracking dashboard** with set/rep history and analytics
- Real-time sync between tracker and dashboard via BroadcastChannel
- **Coach system** with athlete management, invitations, and program creation
- **Training programs** with day/exercise structure and set logging

## Tech Stack

### Backend
- **Framework:** Flask 3.1.2
- **Database:** PostgreSQL (production) / SQLite (development)
- **ORM:** SQLAlchemy 2.0.44 with Flask-SQLAlchemy
- **Migrations:** Flask-Migrate / Alembic
- **Authentication:** Flask-Login with Werkzeug password hashing
- **Payments:** Stripe 14.0.0
- **Server:** Gunicorn 23.0.0
- **Python Version:** 3.11

### Frontend
- **Templates:** Jinja2
- **Styling:** Custom CSS (glassmorphism design system)
- **ML/Pose Detection:** MediaPipe Pose 0.5 (via CDN)
- **JavaScript:** Vanilla JS (no frameworks)

### Deployment
- **Platform:** Fly.io
- **Region:** ORD (Chicago)
- **CI/CD:** GitHub Actions (auto-deploy on push to main)

## Directory Structure

```
Chronicle/
├── app.py                      # Main Flask application (all routes and models)
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Docker configuration
├── fly.toml                    # Fly.io deployment config
├── map.md                      # Project roadmap/notes
├── jest.config.js              # Jest testing configuration
├── package.json                # NPM dependencies (Jest)
├── .github/
│   └── workflows/
│       └── fly-deploy.yml      # Auto-deploy workflow
├── templates/                  # Jinja2 HTML templates
│   ├── base.html               # Base template with shared layout
│   ├── macros.html             # Jinja2 reusable macros
│   ├── index.html              # Landing page
│   ├── login.html              # Login/register page
│   ├── tracker.html            # Main exercise tracking interface
│   ├── dashboard.html          # Workout history and analytics dashboard
│   ├── subscribe.html          # Pricing/subscription page
│   ├── code.html               # Access code redemption
│   ├── setup_password.html     # Post-payment password setup
│   ├── coach_dashboard.html    # Coach dashboard for athlete management
│   ├── join.html               # Coach invite acceptance page
│   └── programs.html           # Training programs page
├── static/                     # Frontend assets
│   ├── squat.js                # Main orchestrator: camera, MediaPipe, workout tracking
│   ├── dashboard.js            # Dashboard logic, API calls, real-time sync
│   ├── login.js                # Auth form handling
│   ├── coach_dashboard.js      # Coach dashboard logic
│   ├── coach_dashboard.css     # Coach dashboard styles
│   ├── programs.js             # Programs page logic
│   ├── programs.css            # Programs page styles
│   ├── universal.css           # Shared styles
│   ├── index.css               # Landing page styles
│   ├── login.css               # Auth page styles
│   ├── tracker.css             # Tracker UI styles
│   ├── dashboard.css           # Dashboard glassmorphism styles
│   ├── code.css                # Access code page styles
│   ├── subscribe.css           # Subscription page styles
│   ├── exercises/              # Modular exercise detection system
│   │   ├── base.js             # Shared constants, state, utilities, calibration
│   │   ├── registry.js         # Exercise registry for dynamic loading
│   │   ├── squat.js            # Back squat detection
│   │   ├── deadlift.js         # Conventional/sumo deadlift
│   │   ├── rdl.js              # Romanian deadlift
│   │   ├── single-leg-rdl.js   # Single-leg RDL
│   │   ├── hack-squat.js       # Hack squat
│   │   ├── bulgarian-squat.js  # Bulgarian split squat
│   │   ├── split-squat.js      # Split squat
│   │   ├── general-squat.js    # General squat variant
│   │   ├── general-lunge.js    # General lunge
│   │   ├── general-hinge.js    # General hinge movement
│   │   ├── bench-press.js      # Flat bench press
│   │   ├── overhead-press.js   # Overhead press
│   │   ├── dips.js             # Dips
│   │   ├── general-press.js    # General press variant
│   │   ├── barbell-row.js      # Barbell row
│   │   ├── dumbbell-row.js     # Dumbbell row
│   │   ├── pendlay-row.js      # Pendlay row
│   │   ├── cable-row.js        # Cable row
│   │   ├── general-pull.js     # General pull variant
│   │   └── row-base.js         # Shared row detection logic
│   └── tests/                  # Frontend test suite
│       ├── test-runner.html    # Browser-based test runner
│       ├── test-base.js        # Tests for base module
│       ├── test-exercises.js   # Tests for exercise modules
│       ├── test-helpers.js     # Test utility functions
│       └── run-node.js         # Node.js test runner (Jest)
├── migrations/                 # Alembic database migrations
│   ├── env.py
│   ├── alembic.ini
│   └── versions/
└── instance/
    └── chronicle.db            # SQLite database (dev only)
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `app.py` | All Flask routes, database models, Stripe webhooks |
| `static/squat.js` | Main orchestrator: MediaPipe, camera, canvas, workout tracking; delegates detection to exercise modules |
| `static/exercises/base.js` | Chronicle namespace, shared constants (`Chronicle.CONSTANTS`), state factory (`Chronicle.createState`), utility functions |
| `static/exercises/registry.js` | Exercise registry (`Chronicle.registry`) for dynamic exercise module lookup |
| `static/exercises/*.js` | Individual exercise detection modules (19 exercises across 4 categories) |
| `static/dashboard.js` | Dashboard logic, workout/set APIs, real-time BroadcastChannel sync, customizable metrics |
| `static/coach_dashboard.js` | Coach athlete management, invitations, program creation |
| `static/programs.js` | Training programs CRUD, exercise logging, velocity tracking integration |
| `templates/tracker.html` | Main UI with video canvas, controls, and save set functionality |
| `templates/dashboard.html` | Workout history, stats overview, customizable lift metrics |
| `templates/coach_dashboard.html` | Coach dashboard for managing athletes and invitations |
| `templates/join.html` | Coach invite acceptance page for athletes |
| `templates/programs.html` | Training programs view and editor |
| `fly.toml` | Deployment configuration for Fly.io |

## Database Models

The application uses multiple SQLAlchemy models for workouts, programs, and coach functionality:

### User Model
```python
User:
  - id: Integer (primary key)
  - email: String (unique, indexed)
  - password_hash: String
  - name: String (optional display name)
  - subscribed: Boolean
  - stripe_customer_id: String
  - subscription_type: String ('monthly', 'annual', 'lifetime')
  - subscription_end_date: DateTime
  - height: Integer (inches, default 58)
  - needs_password_setup: Boolean
  - is_coach: Boolean (coach access flag)
  - coach_id: Integer (FK to User, for athlete-coach relationship)
  - dashboard_metrics: Text (JSON list of selected metrics)
  - created_at: DateTime
  - last_login: DateTime
  - workouts: Relationship (one-to-many with Workout)
  - athletes: Relationship (one-to-many self-referential for coaches)
```

### Workout Model
```python
Workout:
  - id: Integer (primary key)
  - user_id: Integer (foreign key to User)
  - name: String (default: 'Squat Session')
  - exercise_type: String (default: 'squat')
  - notes: Text (optional)
  - created_at: DateTime
  - completed_at: DateTime (null until finished)
  - sets: Relationship (one-to-many with Set)
  - Methods: to_dict() returns workout with sets and calculated totals
```

### Set Model
```python
Set:
  - id: Integer (primary key)
  - workout_id: Integer (foreign key to Workout)
  - set_number: Integer
  - reps_completed: Integer
  - avg_depth: Float (inches)
  - avg_velocity: Float (speed score)
  - min_velocity: Float
  - max_velocity: Float
  - fatigue_drop: Float (velocity % decline from first to last rep)
  - created_at: DateTime
  - reps: Relationship (one-to-many with Rep)
  - Methods: to_dict() returns set with all rep details
```

### Rep Model
```python
Rep:
  - id: Integer (primary key)
  - set_id: Integer (foreign key to Set)
  - rep_number: Integer
  - depth: Float (inches)
  - time_seconds: Float (ascent duration)
  - velocity: Float (speed score)
  - quality: String ('deep', 'parallel', 'half', 'shallow')
  - Methods: to_dict() returns individual rep data
```

### Program Model
```python
Program:
  - id: Integer (primary key)
  - coach_id: Integer (FK to User, null if self-created)
  - athlete_id: Integer (FK to User)
  - name: String
  - description: Text
  - created_at: DateTime
  - start_date: DateTime
  - end_date: DateTime
  - is_active: Boolean
  - days: Relationship (one-to-many with ProgramDay)
```

### ProgramDay Model
```python
ProgramDay:
  - id: Integer (primary key)
  - program_id: Integer (FK to Program)
  - day_number: Integer
  - name: String (e.g., "Lower Body")
  - notes: Text
  - exercises: Relationship (one-to-many with ProgramExercise)
```

### ProgramExercise Model
```python
ProgramExercise:
  - id: Integer (primary key)
  - program_day_id: Integer (FK to ProgramDay)
  - name: String
  - video_url: String (only coaches can set)
  - sets_prescribed: Integer
  - reps_prescribed: String (e.g., "8-10")
  - weight_prescribed: String
  - notes: Text
  - order: Integer
  - exercise_type: String ('standard', 'squat_velocity')
  - set_logs: Relationship (one-to-many with ProgramSetLog)
```

### ProgramSetLog Model
```python
ProgramSetLog:
  - id: Integer (primary key)
  - program_exercise_id: Integer (FK to ProgramExercise)
  - user_id: Integer (FK to User)
  - set_number: Integer
  - reps_completed: Integer
  - weight: Float
  - weight_unit: String ('lbs', 'kg')
  - rpe: Float (Rate of Perceived Exertion)
  - notes: Text
  - velocity_tracked: Boolean
  - workout_set_id: Integer (FK to Set, links to velocity data)
  - created_at: DateTime
  - completed_at: DateTime
```

### CoachInvite Model
```python
CoachInvite:
  - id: Integer (primary key)
  - coach_id: Integer (FK to User)
  - email: String (email to invite)
  - token: String (unique invite token)
  - status: String ('pending', 'accepted', 'expired')
  - created_at: DateTime
  - accepted_at: DateTime
  - athlete_id: Integer (FK to User, set when accepted)
  - Relationships: coach, athlete
  - Methods: to_dict() returns invite data
```

## API Routes

### Public Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Landing page |
| `/login` | GET/POST | User login (JSON API) |
| `/register` | GET/POST | User registration (JSON API) |
| `/subscribe` | GET | Subscription plans page |
| `/webhook` | POST | Stripe webhook handler |
| `/payment-success` | GET | Post-payment redirect |

### Protected Routes (require login)
| Route | Method | Purpose |
|-------|--------|---------|
| `/tracker` | GET | Main VBT application |
| `/dashboard` | GET | Workout history and analytics dashboard |
| `/logout` | GET | Session termination |
| `/code` | GET/POST | Access code redemption |
| `/setup-password` | GET/POST | Password setup for new users |
| `/set_height` | POST | Update user height (JSON API) |
| `/api/subscription-status` | GET | Check subscription (JSON API) |
| `/tests` | GET | Frontend test runner page (development) |

### Workout API Routes (JSON)
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/workouts` | GET | List all user workouts (paginated) |
| `/api/workouts` | POST | Create new workout |
| `/api/workouts/<id>` | GET | Get specific workout details |
| `/api/workouts/<id>` | PUT | Update workout (name, notes, complete) |
| `/api/workouts/<id>` | DELETE | Delete workout (cascade deletes sets/reps) |
| `/api/workouts/<id>/sets` | POST | Add completed set with rep data |
| `/api/workouts/<id>/sets/<set_id>` | DELETE | Delete specific set |
| `/api/workouts/current` | GET | Get active incomplete workout or null |
| `/api/stats` | GET | Get user statistics (totals, velocity trend) |
| `/api/sets/<id>/reps` | POST | Add a rep to an existing set (non-velocity) |
| `/api/sets/<id>/reps/<rep_id>` | DELETE | Delete a rep from a set |

### Coach API Routes (JSON, requires coach access)
| Route | Method | Purpose |
|-------|--------|---------|
| `/coach` | GET | Coach dashboard page |
| `/api/coach/athletes` | GET | List all athletes for this coach |
| `/api/coach/athletes/<id>` | GET | Get detailed athlete info |
| `/api/coach/add-athlete` | POST | Add athlete by email |
| `/api/coach/remove-athlete/<id>` | DELETE | Remove athlete from coach |
| `/api/coach/invites` | GET | List all invitations sent by coach |
| `/api/coach/invite` | POST | Create new coach invite (sends token link) |
| `/api/coach/invites/<id>` | DELETE | Delete/cancel an invitation |
| `/join/<token>` | GET | Public invite acceptance page |
| `/join/<token>` | POST | Process athlete registration via invite |

### Program API Routes (JSON)
| Route | Method | Purpose |
|-------|--------|---------|
| `/programs` | GET | Programs page |
| `/api/programs` | GET | List programs (coach: created, athlete: assigned) |
| `/api/programs` | POST | Create new program |
| `/api/programs/<id>` | GET | Get program with all days/exercises |
| `/api/programs/<id>` | PUT | Update program details |
| `/api/programs/<id>` | DELETE | Delete program |
| `/api/programs/<id>/days` | POST | Add day to program |
| `/api/programs/<id>/days/<day_id>` | PUT/DELETE | Update/delete day |
| `/api/program-days/<id>/exercises` | POST | Add exercise to day |
| `/api/exercises/<id>` | PUT/DELETE | Update/delete exercise |
| `/api/exercises/<id>/log` | POST | Log a completed set |
| `/api/exercises/<id>/log/<log_id>` | PUT/DELETE | Update/delete set log |
| `/api/exercises/<id>/logs` | GET | Get all logs for exercise |

### Dashboard Customization API Routes (JSON)
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboard/metrics` | GET | Get user's selected metrics and available options |
| `/api/dashboard/metrics` | PUT | Update selected metrics (3-6) |
| `/api/dashboard/lift-stats` | GET | Get comprehensive lift statistics |
| `/api/user/profile` | PUT | Update user profile (name, height) |

## Environment Variables

Required in `.env` file or production environment:

```
SECRET_KEY              # Flask session secret
DATABASE_URL            # PostgreSQL connection string (production)
STRIPE_SECRET_KEY       # Stripe API key
STRIPE_WEBHOOK_SECRET   # Webhook signature verification
STRIPE_MONTHLY_LINK     # Stripe Payment Link for monthly plan
STRIPE_ANNUAL_LINK      # Stripe Payment Link for annual plan
ACCESS_CODE             # Code for granting lifetime access
COACH_CODE              # Code for granting coach access
```

## Modular Exercise Detection System

Exercise detection uses a modular architecture under `static/exercises/`. The main orchestrator (`static/squat.js`) delegates detection to exercise-specific modules via the `Chronicle` namespace.

### Architecture

```
Chronicle (global namespace)
├── Chronicle.CONSTANTS      # Shared hyperparameters
├── Chronicle.createState()  # State factory (returns fresh state object)
├── Chronicle.utils          # Shared utilities (calibration, speed score, side detection, etc.)
├── Chronicle.exercises      # Map of exercise key → module
└── Chronicle.registry       # Registry API for exercise lookup
```

### Exercise Modules

Each exercise module in `static/exercises/*.js` registers itself as `Chronicle.exercises[key]` with:
- `name` - Display name
- `sessionName` - Workout session name
- `category` - Exercise category ('squat', 'hinge', 'press', 'pull')
- `needsWrist` - Boolean, true for upper body exercises
- `needsHip` - Boolean, true for lower body exercises
- `isSingleLeg` - Boolean, for single-leg variants
- `referenceDepth` - Expected ROM in inches (for speed score normalization)
- `detect(landmarks, state, ui)` - Main detection function called each frame
- `getQuality(depthInches)` - Returns depth quality label
- `reset(state)` - Resets exercise-specific state

### Supported Exercises (19 total)

| Category | Exercises |
|----------|-----------|
| Squat | squat, hack-squat, bulgarian-squat, split-squat, general-squat, general-lunge |
| Hinge | deadlift, rdl, single-leg-rdl, general-hinge |
| Press | bench-press, overhead-press, dips, general-press |
| Pull | barbell-row, dumbbell-row, pendlay-row, cable-row, general-pull |

### Shared Constants (`Chronicle.CONSTANTS`)

```javascript
// Calibration
CALIBRATION_SAMPLES: 5
CALIBRATION_TOLERANCE_MULTIPLIER: 0.12
RECALIBRATION_TIMEOUT_MS: 8000

// Position smoothing
POSITION_SMOOTHING_ALPHA: 0.5
OUTLIER_THRESHOLD_MULTIPLIER: 6.0
VELOCITY_EMA_ALPHA: 0.4

// Speed score
SPEED_SCORE_MULTIPLIER: 1000
STANDARD_REFERENCE_DEPTH: 15    // Back squat parallel depth (normalization baseline)

// State timeouts
MAX_DESCENT_TIME_MS: 6000
MAX_ASCENT_TIME_MS: 6000

// Standing / drift
HORIZONTAL_MOVEMENT_THRESHOLD: 0.08
VELOCITY_THRESHOLD: 0.001
```

### State Flow (Lower Body)
```
standing → descending → ascending → (rep counted) → standing
```

### State Flow (Upper Body - Press)
```
lockout → descending → ascending → lockout (rep counted)
```

### Key Detection Features
- Hip-knee joint tracking for lower body depth measurement
- Wrist-elbow-shoulder tracking for upper body exercises
- Torso angle tracking for hinge movements
- Automatic side detection (left/right body side)
- Single-leg variant support with per-side rep counting
- Stance detection (conventional vs sumo for deadlifts)
- Speed score normalization across exercise types via `referenceDepth`
- Horizontal drift detection
- Auto-recalibration after inactivity
- Row elbow fallback tracking when wrists aren't visible

## Workout Tracking Dashboard

The dashboard provides workout history tracking and analytics with real-time sync to the tracker.

### Dashboard Features
- **Stats Overview**: Total workouts, sets, reps, and average velocity with animated counters
- **Current Workout**: Active session with live set list, editable title, finish button
- **Workout History**: Paginated list of completed workouts with expandable details
- **Set Metrics**: Reps, average depth, average speed, fatigue drop percentage

### Tracker Integration
Key functions in `squat.js` (main orchestrator) for workout persistence:
- `initExerciseState()` - Initializes `Chronicle.createState()` and loads exercise module via `Chronicle.registry`
- `initWorkout()` - Fetches/creates current workout on page load
- `recordRep(time, depth, velocity, quality)` - Stores rep data during set
- `saveSet()` - POSTs completed set to API, broadcasts to dashboard

### Real-time Sync
The tracker and dashboard communicate via BroadcastChannel:
```javascript
// Channel name
const channel = new BroadcastChannel('chronicle-workout');

// Tracker posts when set saved
channel.postMessage({ type: 'SET_ADDED', set: setData });

// Dashboard listens and refreshes
channel.onmessage = (event) => {
  if (event.data.type === 'SET_ADDED') {
    loadCurrentWorkout();
    loadStats();
  }
};
```

### UI Components (tracker.html)
- Navigation bar with back link to dashboard
- Set counter badge (e.g., "Set 1", "Set 2")
- "Save Set" button with pulse animation when reps recorded

## Development Workflow

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env  # Edit with your values

# Run development server
python app.py
```

The app runs on `http://localhost:5000` with SQLite database.

### Database Migrations

```bash
# Create a new migration
flask db migrate -m "Description of changes"

# Apply migrations
flask db upgrade

# Rollback
flask db downgrade
```

### Deployment

Deployment is automatic via GitHub Actions on push to `main` branch. The workflow:
1. Builds Docker image
2. Runs `flask db upgrade` as release command
3. Deploys to Fly.io

Manual deployment:
```bash
fly deploy
```

## Coding Conventions

### Python/Flask
- Single `app.py` file (no blueprints)
- JSON APIs return `{'success': True}` or `{'error': 'message'}`
- Email normalization: `email.lower().strip()`
- Password minimum: 8 characters
- Print statements for logging (e.g., `print(f"✅ Message")`)

### JavaScript
- Vanilla JS, no frameworks
- Modular exercise system via `Chronicle` global namespace
- Constants centralized in `Chronicle.CONSTANTS` (SCREAMING_SNAKE_CASE)
- Debug mode toggle via `DEBUG_MODE = true`
- State machine pattern for tracking logic
- Canvas-based visualization
- Exercise modules self-register on `Chronicle.exercises`

### CSS
- Glassmorphism design with blur effects
- Color palette: Blue (#60a5fa) to Purple (#a78bfa) gradients
- Dark background: #0f0f23 to #1a1a2e
- Mobile breakpoint: 768px
- Max container width: 1200px

### Templates
- Jinja2 templating
- `current_user` available in all templates
- Custom filter: `format_height` for height display

## Common Tasks

### Adding a New Route

1. Add route in `app.py`:
```python
@app.route('/new-route')
@login_required  # if protected
def new_route():
    return render_template('new_route.html')
```

2. Create template in `templates/new_route.html`
3. Add styles in `static/new_route.css`

### Modifying Exercise Detection

Exercise detection is modular. To modify an exercise, edit its module in `static/exercises/`:

**Key files:**
- `static/exercises/base.js` - Shared constants (`Chronicle.CONSTANTS`), state (`Chronicle.createState`), utilities (`Chronicle.utils`)
- `static/exercises/<exercise>.js` - Exercise-specific `detect()`, `getQuality()`, `reset()` methods
- `static/exercises/registry.js` - Registry for exercise lookup
- `static/squat.js` - Main orchestrator (camera, MediaPipe, canvas, workout tracking)

**Key utility functions in `Chronicle.utils`:**
- `detectSide(landmarks)` - Automatic left/right side detection
- `processHipPosition(landmarks, state)` - Hip tracking and smoothing
- `calibrateHipBaseline(state)` - Standing baseline calibration
- `calculateSpeedScore(time, depth, referenceDepth)` - Normalized velocity scoring
- `calculateTorsoAngle(shoulderX, shoulderY, hipX, hipY)` - Torso angle for hinges
- `calculateKneeAngle(...)` - Knee angle calculation

**Orchestrator functions in `squat.js`:**
- `initExerciseState()` - Load exercise module and create state
- `initWorkout()` - Initialize/fetch current workout
- `recordRep()` - Store rep data for set saving
- `saveSet()` - Save completed set to API

### Testing Payments

Use Stripe test mode with test cards:
- Success: `4242 4242 4242 4242`
- Declined: `4000 0000 0000 0002`

Webhook testing:
```bash
stripe listen --forward-to localhost:5000/webhook
```

## Known Issues / Roadmap

From `map.md`:
- Simulator -- sideways
- More robust simulator controls or just a better understanding on how to change it
- UI overhaul
- Check knees from caving in, torso angle, and shin angle

## Exercise Tracking by Category

### MediaPipe Landmarks Used
| Landmark Index | Name | Use |
|----------------|------|-----|
| 11 / 12 | Left / Right Shoulder | Shoulder position, torso angle |
| 13 / 14 | Left / Right Elbow | Elbow angle for press/row depth |
| 15 / 16 | Left / Right Wrist | Bar/hand path tracking (upper body) |
| 23 / 24 | Left / Right Hip | Hip tracking (lower body primary metric) |
| 25 / 26 | Left / Right Knee | Knee angle, depth reference |
| 27 / 28 | Left / Right Ankle | Stance width detection |

### Lower Body (Hip Tracking)
- **Squats**: Track hip Y position descent from standing baseline
- **Hinges** (deadlift, RDL): Track torso angle + hip position
- **Single-leg**: Per-side rep counting with working leg detection
- **State machine**: `standing → descending → ascending → standing`

### Upper Body - Press (Wrist Tracking) - Implemented
- **Bench Press**: Track wrist Y position descent/ascent; `lockout → descending → ascending → lockout`
- **Overhead Press**: Track wrist Y position overhead
- **Dips**: Shoulder/elbow tracking in vertical plane
- **Speed score**: Normalized with exercise-specific `referenceDepth` (inches of wrist travel)
- **Camera setup**: Side view, needs shoulder + elbow + wrist visible

### Upper Body - Pull/Row (Wrist/Elbow Tracking) - Implemented
- **Row variants**: Track wrist/elbow position relative to torso in hinged position
- **Elbow fallback**: When wrists aren't visible, tracks elbow with calibrated offset
- **Camera setup**: Side view, needs shoulder + hip + wrist visible

### Camera Visibility Requirements
| Category | Required Landmarks | Camera Position |
|----------|-------------------|-----------------|
| Squat variations | Hip, Knee | Side view |
| Deadlift / Hinge | Shoulder, Hip, Knee | Side view |
| Bench Press | Shoulder, Elbow, Wrist | Side view (from head or foot of bench) |
| Overhead Press | Shoulder, Elbow, Wrist | Side view |
| Row | Shoulder, Hip, Wrist | Side view |

## Testing

### Frontend Tests (Jest)
```bash
# Run all frontend tests
npx jest

# Run specific test file
npx jest static/tests/test-base.js
```

Test files are in `static/tests/`:
- `test-base.js` - Tests for the base exercise module
- `test-exercises.js` - Tests for individual exercise modules
- `test-helpers.js` - Shared test utilities
- `run-node.js` - Node.js test runner
- `test-runner.html` - Browser-based test runner (accessible at `/tests` in dev)

## Security Notes

- Passwords hashed with Werkzeug (bcrypt-based)
- Stripe webhook signature verification required
- HTTPS forced in production
- Session-based authentication
- No sensitive data stored in cookies

## Performance Considerations

- MediaPipe runs client-side (no server load for pose detection)
- SQLite for development, PostgreSQL for production
- Fly.io auto-scales to 0 when idle
- Static assets can be CDN-cached

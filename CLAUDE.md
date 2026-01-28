# Chronicle - AI Assistant Guide

## Project Overview

Chronicle is a **Velocity-Based Training (VBT) web application** that enables real-time squat tracking using only a smartphone camera. It delivers professional-grade performance metrics without expensive sensor hardware by leveraging MediaPipe for pose detection.

### Key Value Proposition
- Phone camera-powered squat tracking (no sensors required)
- Real-time velocity feedback for athletes
- Objective squat depth measurement
- Speed score calculations for strength training

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
├── .github/
│   └── workflows/
│       └── fly-deploy.yml      # Auto-deploy workflow
├── templates/                  # Jinja2 HTML templates
│   ├── index.html              # Landing page
│   ├── login.html              # Login/register page
│   ├── tracker.html            # Main squat tracking interface
│   ├── subscribe.html          # Pricing/subscription page
│   ├── code.html               # Access code redemption
│   └── setup_password.html     # Post-payment password setup
├── static/                     # Frontend assets
│   ├── squat.js                # Core tracking logic (~935 lines)
│   ├── login.js                # Auth form handling
│   ├── universal.css           # Shared styles
│   ├── index.css               # Landing page styles
│   ├── login.css               # Auth page styles
│   ├── tracker.css             # Tracker UI styles
│   ├── code.css                # Access code page styles
│   └── subscribe.css           # Subscription page styles
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
| `static/squat.js` | MediaPipe pose detection, squat state machine, velocity calculations |
| `templates/tracker.html` | Main UI with video canvas and controls |
| `fly.toml` | Deployment configuration for Fly.io |

## Database Model

The application uses a single `User` model:

```python
User:
  - id: Integer (primary key)
  - email: String (unique, indexed)
  - password_hash: String
  - subscribed: Boolean
  - stripe_customer_id: String
  - subscription_type: String ('monthly', 'annual', 'lifetime')
  - subscription_end_date: DateTime
  - height: Integer (inches, default 58)
  - needs_password_setup: Boolean
  - created_at: DateTime
  - last_login: DateTime
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
| `/logout` | GET | Session termination |
| `/code` | GET/POST | Access code redemption |
| `/setup-password` | GET/POST | Password setup for new users |
| `/set_height` | POST | Update user height (JSON API) |
| `/api/subscription-status` | GET | Check subscription (JSON API) |

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
```

## Squat Detection Algorithm

The `squat.js` file implements a state machine with key hyperparameters:

```javascript
// Depth thresholds
MIN_DEPTH_INCHES = 6           // Minimum for valid rep
DEPTH_MARKER_HALF = 6          // Half squat
DEPTH_MARKER_PARALLEL = 15.5   // Parallel depth
DEPTH_MARKER_DEEP = 17.5       // Deep squat

// Calibration
CALIBRATION_SAMPLES = 5
CALIBRATION_TOLERANCE_MULTIPLIER = 0.12
RECALIBRATION_TIMEOUT_MS = 8000

// State machine
DESCENT_THRESHOLD_INCHES = 3.5
RECOVERY_PERCENT = 80
VELOCITY_THRESHOLD = 0.001
```

### State Flow
```
standing → descending → ascending → (rep counted) → standing
```

### Key Detection Features
- Hip-knee joint tracking for depth measurement
- Automatic side detection (left/right body side)
- Velocity-based rep timing
- Horizontal drift detection
- Auto-recalibration after inactivity

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
- Constants in SCREAMING_SNAKE_CASE
- Debug mode toggle via `DEBUG_MODE = true`
- State machine pattern for tracking logic
- Canvas-based visualization

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

### Modifying Squat Detection

Key functions in `squat.js`:
- `detectSquat(landmarks)` - Main detection logic
- `updateStatus(newState)` - State transitions
- `resetToStanding()` - Reset tracking state
- `calculateSpeedScore()` - Velocity calculations

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
- Simulator for sideways movement testing
- UI overhaul needed
- Add knee cave detection
- Torso and shin angle tracking

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

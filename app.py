from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
import stripe
import os
from dotenv import load_dotenv
from datetime import datetime
import json
import jinja2
from functools import wraps

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')

# Database configuration
DATABASE_URL = os.getenv('DATABASE_URL')
if DATABASE_URL and DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chronicle.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

migrate = Migrate(app, db)
# Flask-Login setup
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Stripe configuration
stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
WEBHOOK_SECRET = os.getenv('STRIPE_WEBHOOK_SECRET')
STRIPE_MONTHLY_LINK = os.getenv('STRIPE_MONTHLY_LINK', 'https://buy.stripe.com/your-monthly-link')
STRIPE_ANNUAL_LINK = os.getenv('STRIPE_ANNUAL_LINK', 'https://buy.stripe.com/your-annual-link')
ACCESS_CODE = os.getenv('ACCESS_CODE')
COACH_CODE = os.getenv('COACH_CODE')
# Database Models
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(100), nullable=True)  # Display name
    subscribed = db.Column(db.Boolean, default=False)
    stripe_customer_id = db.Column(db.String(255), nullable=True)
    subscription_type = db.Column(db.String(50), nullable=True)  # 'monthly' or 'annual'
    subscription_end_date = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)
    height = db.Column(db.Integer, default=58)  # Default height in inches
    needs_password_setup = db.Column(db.Boolean, default=False)  # Flag for users created via payment

    # Coach system
    is_coach = db.Column(db.Boolean, default=False)
    coach_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)  # For athletes linked to a coach

    # Dashboard customization - JSON string of metric names
    dashboard_metrics = db.Column(db.Text, nullable=True)  # e.g. '["squat", "bench", "deadlift"]'

    # Relationships
    athletes = db.relationship('User', backref=db.backref('coach', remote_side=[id]), lazy='dynamic')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def get_dashboard_metrics(self):
        if self.dashboard_metrics:
            try:
                return json.loads(self.dashboard_metrics)
            except:
                return []
        return []

    def set_dashboard_metrics(self, metrics):
        self.dashboard_metrics = json.dumps(metrics[:6])  # Max 6 metrics

    def get_display_name(self):
        return self.name or self.email.split('@')[0]


class Workout(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), default='Squat Session')
    exercise_type = db.Column(db.String(50), default='squat')
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship('User', backref=db.backref('workouts', lazy='dynamic', order_by='Workout.created_at.desc()'))
    sets = db.relationship('Set', backref='workout', lazy='dynamic', order_by='Set.set_number', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'exercise_type': self.exercise_type,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'sets': [s.to_dict() for s in self.sets],
            'total_reps': sum(s.reps_completed for s in self.sets),
            'set_count': self.sets.count()
        }


class Set(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    workout_id = db.Column(db.Integer, db.ForeignKey('workout.id'), nullable=False)
    set_number = db.Column(db.Integer, nullable=False)
    reps_completed = db.Column(db.Integer, default=0)
    avg_depth = db.Column(db.Float, nullable=True)  # Average depth in inches
    avg_velocity = db.Column(db.Float, nullable=True)  # Average speed score
    min_velocity = db.Column(db.Float, nullable=True)  # Slowest rep speed score
    max_velocity = db.Column(db.Float, nullable=True)  # Fastest rep speed score
    fatigue_drop = db.Column(db.Float, nullable=True)  # Percentage drop from first rep
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    reps = db.relationship('Rep', backref='set', lazy='dynamic', order_by='Rep.rep_number', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'set_number': self.set_number,
            'reps_completed': self.reps_completed,
            'avg_depth': round(self.avg_depth, 1) if self.avg_depth else None,
            'avg_velocity': round(self.avg_velocity) if self.avg_velocity else None,
            'min_velocity': round(self.min_velocity) if self.min_velocity else None,
            'max_velocity': round(self.max_velocity) if self.max_velocity else None,
            'fatigue_drop': round(self.fatigue_drop, 1) if self.fatigue_drop else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'reps': [r.to_dict() for r in self.reps]
        }


class Rep(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    set_id = db.Column(db.Integer, db.ForeignKey('set.id'), nullable=False)
    rep_number = db.Column(db.Integer, nullable=False)
    depth = db.Column(db.Float, nullable=True)  # Depth in inches
    time_seconds = db.Column(db.Float, nullable=True)  # Ascent time
    velocity = db.Column(db.Float, nullable=True)  # Speed score
    quality = db.Column(db.String(20), nullable=True)  # 'deep', 'parallel', 'half', 'shallow'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'rep_number': self.rep_number,
            'depth': round(self.depth, 1) if self.depth else None,
            'time_seconds': round(self.time_seconds, 2) if self.time_seconds else None,
            'velocity': round(self.velocity) if self.velocity else None,
            'quality': self.quality
        }


# ========== Program Models ==========

class Program(db.Model):
    """A training program created by a coach for an athlete, or by a user for themselves"""
    id = db.Column(db.Integer, primary_key=True)
    coach_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)  # Null if self-created
    athlete_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    start_date = db.Column(db.DateTime, nullable=True)
    end_date = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.Boolean, default=True)

    # Relationships
    coach = db.relationship('User', foreign_keys=[coach_id], backref='programs_created')
    athlete = db.relationship('User', foreign_keys=[athlete_id], backref='programs_assigned')
    days = db.relationship('ProgramDay', backref='program', lazy='dynamic', order_by='ProgramDay.day_number', cascade='all, delete-orphan')

    def to_dict(self, include_days=True):
        result = {
            'id': self.id,
            'coach_id': self.coach_id,
            'athlete_id': self.athlete_id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'is_active': self.is_active
        }
        if include_days:
            result['days'] = [d.to_dict() for d in self.days]
        return result


class ProgramDay(db.Model):
    """A single day/session within a program"""
    id = db.Column(db.Integer, primary_key=True)
    program_id = db.Column(db.Integer, db.ForeignKey('program.id'), nullable=False)
    day_number = db.Column(db.Integer, nullable=False)  # 1, 2, 3, etc.
    name = db.Column(db.String(100), nullable=True)  # e.g., "Lower Body", "Upper Body"
    notes = db.Column(db.Text, nullable=True)

    exercises = db.relationship('ProgramExercise', backref='day', lazy='dynamic', order_by='ProgramExercise.order', cascade='all, delete-orphan')

    def to_dict(self, include_exercises=True):
        result = {
            'id': self.id,
            'program_id': self.program_id,
            'day_number': self.day_number,
            'name': self.name,
            'notes': self.notes
        }
        if include_exercises:
            result['exercises'] = [e.to_dict() for e in self.exercises]
        return result


class ProgramExercise(db.Model):
    """An exercise within a program day"""
    id = db.Column(db.Integer, primary_key=True)
    program_day_id = db.Column(db.Integer, db.ForeignKey('program_day.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    video_url = db.Column(db.String(500), nullable=True)  # Only coaches can set this
    sets_prescribed = db.Column(db.Integer, default=3)
    reps_prescribed = db.Column(db.String(50), default='8-10')  # Can be range like "8-10" or "5"
    weight_prescribed = db.Column(db.String(100), nullable=True)  # e.g., "135 lbs", "RPE 8", "70%"
    notes = db.Column(db.Text, nullable=True)
    order = db.Column(db.Integer, default=0)
    exercise_type = db.Column(db.String(50), default='standard')  # 'standard', 'squat_velocity'

    set_logs = db.relationship('ProgramSetLog', backref='exercise', lazy='dynamic', cascade='all, delete-orphan')

    def to_dict(self, include_logs=False):
        result = {
            'id': self.id,
            'program_day_id': self.program_day_id,
            'name': self.name,
            'video_url': self.video_url,
            'sets_prescribed': self.sets_prescribed,
            'reps_prescribed': self.reps_prescribed,
            'weight_prescribed': self.weight_prescribed,
            'notes': self.notes,
            'order': self.order,
            'exercise_type': self.exercise_type
        }
        if include_logs:
            result['set_logs'] = [l.to_dict() for l in self.set_logs.order_by(ProgramSetLog.created_at.desc()).limit(20)]
        return result


class ProgramSetLog(db.Model):
    """Logged performance for a set in a program exercise"""
    id = db.Column(db.Integer, primary_key=True)
    program_exercise_id = db.Column(db.Integer, db.ForeignKey('program_exercise.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    set_number = db.Column(db.Integer, nullable=False)
    reps_completed = db.Column(db.Integer, nullable=True)
    weight = db.Column(db.Float, nullable=True)  # Weight in lbs
    weight_unit = db.Column(db.String(10), default='lbs')  # 'lbs' or 'kg'
    rpe = db.Column(db.Float, nullable=True)  # Rate of Perceived Exertion
    notes = db.Column(db.Text, nullable=True)

    # Velocity tracking link
    velocity_tracked = db.Column(db.Boolean, default=False)
    workout_set_id = db.Column(db.Integer, db.ForeignKey('set.id'), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    user = db.relationship('User', backref='program_logs')
    workout_set = db.relationship('Set', backref='program_log')

    def to_dict(self):
        result = {
            'id': self.id,
            'program_exercise_id': self.program_exercise_id,
            'user_id': self.user_id,
            'set_number': self.set_number,
            'reps_completed': self.reps_completed,
            'weight': self.weight,
            'weight_unit': self.weight_unit,
            'rpe': self.rpe,
            'notes': self.notes,
            'velocity_tracked': self.velocity_tracked,
            'workout_set_id': self.workout_set_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None
        }
        # Include velocity data if tracked
        if self.velocity_tracked and self.workout_set:
            result['velocity_data'] = self.workout_set.to_dict()
        return result


class CoachInvite(db.Model):
    """Invitation from a coach to an athlete"""
    id = db.Column(db.Integer, primary_key=True)
    coach_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    email = db.Column(db.String(120), nullable=False)  # Email to invite
    token = db.Column(db.String(64), unique=True, nullable=False)  # Unique invite token
    status = db.Column(db.String(20), default='pending')  # pending, accepted, expired
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    accepted_at = db.Column(db.DateTime, nullable=True)
    athlete_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)  # Set when accepted

    # Relationships
    coach = db.relationship('User', foreign_keys=[coach_id], backref='invites_sent')
    athlete = db.relationship('User', foreign_keys=[athlete_id], backref='invite_accepted')

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'accepted_at': self.accepted_at.isoformat() if self.accepted_at else None,
            'athlete_id': self.athlete_id
        }


# Create tables
with app.app_context():
    db.create_all()

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


def coach_required(f):
    """Decorator to require coach access"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return redirect(url_for('login'))
        if not current_user.is_coach:
            return jsonify({'error': 'Coach access required'}), 403
        return f(*args, **kwargs)
    return decorated_function


@app.template_filter('format_height')
def format_height(height):
    feet = height // 12
    inches = height % 12
    return f"{feet}'{inches}\""


# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        if current_user.is_coach:
            return redirect(url_for('coach_dashboard'))
        return redirect(url_for('tracker') if current_user.subscribed else url_for('subscribe'))

    if request.method == 'POST':
        data = request.get_json()
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Email and password required'}), 400

        user = User.query.filter_by(email=email).first()

        if user and user.check_password(password):
            login_user(user, remember=True)
            user.last_login = datetime.utcnow()
            db.session.commit()

            # Redirect coaches to coach dashboard
            if user.is_coach:
                redirect_url = url_for('coach_dashboard')
            else:
                redirect_url = url_for('dashboard') if user.subscribed else url_for('subscribe')
            return jsonify({'success': True, 'redirect': redirect_url})
        else:
            return jsonify({'error': 'Invalid email or password'}), 401

    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('tracker') if current_user.subscribed else url_for('subscribe'))
    
    if request.method == 'POST':
        data = request.get_json()
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Email and password required'}), 400
        
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        # Check if user already exists
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'Email already registered'}), 400
        
        # Create new user
        user = User(email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        
        login_user(user, remember=True)
        return jsonify({'success': True, 'redirect': url_for('subscribe')})
    
    # GET request - render the login page (which has register toggle)
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/subscribe')
def subscribe():
    return render_template('subscribe.html', 
                         stripe_monthly_link=STRIPE_MONTHLY_LINK,
                         stripe_annual_link=STRIPE_ANNUAL_LINK)

@app.route('/tracker')
@login_required
def tracker():
    if not current_user.subscribed:
        return redirect(url_for('subscribe'))
    exercise_type = request.args.get('exercise', 'squat')
    valid_exercises = {
        'squat': 'Squat',
        'deadlift': 'Deadlift',
        'rdl': 'RDL',
        'single-leg-rdl': 'Single Leg RDL',
        'hack-squat': 'Hack Squat',
        'bulgarian-squat': 'Bulgarian Squat',
        'split-squat': 'Split Squat',
        'general-squat': 'General Squat',
        'general-lunge': 'General Lunge',
        'general-hinge': 'General Hinge',
        'bench-press': 'Bench Press',
        'overhead-press': 'Overhead Press',
        'general-press': 'General Press',
        'barbell-row': 'Barbell Row',
        'dumbbell-row': 'Dumbbell Row',
        'pendlay-row': 'Pendlay Row',
        'cable-row': 'Cable Row',
        'general-pull': 'General Pull',
    }
    if exercise_type not in valid_exercises:
        exercise_type = 'squat'
    return render_template('tracker.html', height=current_user.height,
                         exercise_type=exercise_type,
                         exercise_name=valid_exercises[exercise_type])

@app.route("/set_height", methods= ['POST'])
@login_required
def set_height():
    data = request.get_json()
    height = data.get('height')
    
    if not height or not isinstance(height, int) or height <= 0:
        return jsonify({'error': 'Valid height required'}), 400
    
    current_user.height = height
    db.session.commit()
    
    return jsonify({'success': True, 'height': current_user.height})




@app.route('/code', methods=['GET', 'POST'])
@login_required
def access_code():
    # If user is already subscribed and not a coach trying coach code, redirect
    if current_user.subscribed and current_user.is_coach:
        return redirect(url_for('coach_dashboard'))
    if current_user.subscribed and not current_user.is_coach:
        return redirect(url_for('tracker'))

    if request.method == 'POST':
        data = request.get_json()
        code = data.get('code', '').strip().upper()

        if not code:
            return jsonify({'error': 'Code required'}), 400

        # Check if code matches ACCESS_CODE (lifetime athlete access)
        if ACCESS_CODE and code == ACCESS_CODE.upper():
            current_user.subscribed = True
            current_user.subscription_type = 'lifetime'
            db.session.commit()

            print(f"✅ Lifetime access granted to {current_user.email} via access code")
            return jsonify({'success': True, 'message': 'Access granted!', 'redirect': url_for('tracker')})

        # Check if code matches COACH_CODE (coach access)
        if COACH_CODE and code == COACH_CODE.upper():
            current_user.subscribed = True
            current_user.subscription_type = 'lifetime'
            current_user.is_coach = True
            db.session.commit()

            print(f"✅ Coach access granted to {current_user.email} via coach code")
            return jsonify({'success': True, 'message': 'Coach access granted!', 'redirect': url_for('coach_dashboard')})

        return jsonify({'error': 'Invalid access code'}), 401

    # GET request - render the code page
    return render_template('code.html')
@app.route('/setup-password', methods=['GET', 'POST'])
def setup_password():
    # If user doesn't need password setup, redirect them
    if not current_user.needs_password_setup:
        return redirect(url_for('tracker') if current_user.subscribed else url_for('subscribe'))
    
    if request.method == 'POST':
        data = request.get_json()
        password = data.get('password', '')
        
        if not password:
            return jsonify({'error': 'Password required'}), 400
        
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        # Set the new password
        current_user.set_password(password)
        current_user.needs_password_setup = False
        db.session.commit()
        
        print(f"✅ Password set for {current_user.email}")
        
        # Redirect to tracker since they already have a subscription
        return jsonify({'success': True, 'redirect': url_for('tracker')})
    
    return render_template('setup_password.html')

@app.route('/payment-success')
def payment_success():
    """
    Landing page after Stripe payment.
    Since we can't get email from Payment Links, we use session_id to look up the checkout.
    """
    session_id = request.args.get('session_id', '').strip()
    
    try:
        # Retrieve the checkout session from Stripe to get customer email
        checkout_session = stripe.checkout.Session.retrieve(session_id)
        email = checkout_session['customer_details']['email'].lower()
        
        # Check if user exists
        user = User.query.filter_by(email=email).first()
        
        if user:
            # Check if they need to set up a password
            if user.needs_password_setup:
                # Log them in automatically and redirect to password setup
                login_user(user, remember=True)
                return redirect(url_for('setup_password'))
            elif current_user.is_authenticated:
                return redirect(url_for('tracker'))
            else:
                return redirect(url_for('login'))
    except stripe.error.StripeError as e:
        print(f"Error retrieving checkout session: {e}")
        return render_template('payment_success.html',
                             show_login=True,
                             message="Payment successful! Please log in to access your account.")

@app.route('/webhook', methods=['POST'])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get('Stripe-Signature')
    
    try:
        event = stripe.Webhook.construct_event(
            payload, 
            sig_header, 
            WEBHOOK_SECRET
        )
    except Exception as e:
        print(f"Webhook signature verification failed: {e}")
        return jsonify({'error': 'Invalid signature'}), 400
    
    try:
        # Handle successful payment
        if event['type'] == 'checkout.session.completed':
            session_obj = event['data']['object']
            email = session_obj['customer_details']['email'].lower()
            customer_id = session_obj.get('customer')
            
            # Get subscription details
            subscription_id = session_obj.get('subscription')
            subscription_type = 'monthly'  # Default
            
            if subscription_id:
                subscription = stripe.Subscription.retrieve(subscription_id)
                # Determine if monthly or annual based on price
                if subscription['items']['data']:
                    price = subscription['items']['data'][0]['price']
                    if price['recurring']['interval'] == 'year':
                        subscription_type = 'annual'
            
            # Check if user exists
            user = User.query.filter_by(email=email).first()
            
            if user:
                # Existing user - just update subscription
                user.subscribed = True
                user.stripe_customer_id = customer_id
                user.subscription_type = subscription_type
                print(f"✅ Subscription activated for existing user {email} ({subscription_type})")
            else:
                # New user - create account with temporary password
                user = User(
                    email=email,
                    subscribed=True,
                    stripe_customer_id=customer_id,
                    subscription_type=subscription_type,
                    needs_password_setup=True  # Flag them to set password
                )
                # Set a temporary random password
                user.set_password(os.urandom(24).hex())
                db.session.add(user)
                print(f"✅ New user created for {email} ({subscription_type}) - needs password setup")
            
            db.session.commit()
            
            # Update Stripe session to redirect to our success page with email
            # Note: You'll need to configure this in your Stripe Payment Link settings
            # or use the Stripe API to create sessions programmatically
        
        # Handle subscription cancellation
        elif event['type'] == 'customer.subscription.deleted':
            subscription = event['data']['object']
            customer_id = subscription['customer']
            
            user = User.query.filter_by(stripe_customer_id=customer_id).first()
            if user:
                user.subscribed = False
                user.subscription_end_date = datetime.utcnow()
                db.session.commit()
                print(f"✅ Subscription cancelled for {user.email}")
        
        # Handle subscription updates
        elif event['type'] == 'customer.subscription.updated':
            subscription = event['data']['object']
            customer_id = subscription['customer']
            
            user = User.query.filter_by(stripe_customer_id=customer_id).first()
            if user:
                # Update subscription status based on current status
                user.subscribed = subscription['status'] == 'active'
                db.session.commit()
                print(f"✅ Subscription updated for {user.email}")
        
        return jsonify({'success': True}), 200
        
    except Exception as e:
        print(f"❌ Webhook error: {e}")
        return jsonify({'error': str(e)}), 400

@app.route('/api/subscription-status', methods=['GET'])
@login_required
def subscription_status():
    return jsonify({
        'subscribed': current_user.subscribed,
        'subscription_type': current_user.subscription_type,
        'email': current_user.email
    })


# ========== Dashboard & Workout Tracking Routes ==========

@app.route('/dashboard')
@login_required
def dashboard():
    if not current_user.subscribed:
        return redirect(url_for('subscribe'))
    return render_template('dashboard.html')


@app.route('/api/workouts', methods=['GET'])
@login_required
def get_workouts():
    """Get all workouts for the current user"""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)

    workouts = Workout.query.filter_by(user_id=current_user.id)\
        .order_by(Workout.created_at.desc())\
        .paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        'success': True,
        'workouts': [w.to_dict() for w in workouts.items],
        'total': workouts.total,
        'pages': workouts.pages,
        'current_page': page
    })


@app.route('/api/workouts', methods=['POST'])
@login_required
def create_workout():
    """Create a new workout session"""
    data = request.get_json() or {}

    workout = Workout(
        user_id=current_user.id,
        name=data.get('name', 'Squat Session'),
        exercise_type=data.get('exercise_type', 'squat'),
        notes=data.get('notes')
    )
    db.session.add(workout)
    db.session.commit()

    print(f"✅ Workout created for {current_user.email}: {workout.name}")
    return jsonify({'success': True, 'workout': workout.to_dict()}), 201


@app.route('/api/workouts/<int:workout_id>', methods=['GET'])
@login_required
def get_workout(workout_id):
    """Get a specific workout with all sets and reps"""
    workout = Workout.query.filter_by(id=workout_id, user_id=current_user.id).first()
    if not workout:
        return jsonify({'error': 'Workout not found'}), 404

    return jsonify({'success': True, 'workout': workout.to_dict()})


@app.route('/api/workouts/<int:workout_id>', methods=['PUT'])
@login_required
def update_workout(workout_id):
    """Update a workout (name, notes, complete it)"""
    workout = Workout.query.filter_by(id=workout_id, user_id=current_user.id).first()
    if not workout:
        return jsonify({'error': 'Workout not found'}), 404

    data = request.get_json() or {}

    if 'name' in data:
        workout.name = data['name']
    if 'notes' in data:
        workout.notes = data['notes']
    if data.get('complete'):
        workout.completed_at = datetime.utcnow()

    db.session.commit()
    return jsonify({'success': True, 'workout': workout.to_dict()})


@app.route('/api/workouts/<int:workout_id>', methods=['DELETE'])
@login_required
def delete_workout(workout_id):
    """Delete a workout and all its sets/reps"""
    workout = Workout.query.filter_by(id=workout_id, user_id=current_user.id).first()
    if not workout:
        return jsonify({'error': 'Workout not found'}), 404

    db.session.delete(workout)
    db.session.commit()

    print(f"✅ Workout deleted for {current_user.email}: {workout.name}")
    return jsonify({'success': True})


@app.route('/api/workouts/<int:workout_id>/sets', methods=['POST'])
@login_required
def add_set(workout_id):
    """Add a completed set to a workout"""
    workout = Workout.query.filter_by(id=workout_id, user_id=current_user.id).first()
    if not workout:
        return jsonify({'error': 'Workout not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Set data required'}), 400

    # Get the next set number
    last_set = Set.query.filter_by(workout_id=workout_id).order_by(Set.set_number.desc()).first()
    set_number = (last_set.set_number + 1) if last_set else 1

    # Calculate metrics from reps data
    reps_data = data.get('reps', [])
    velocities = [r.get('velocity') for r in reps_data if r.get('velocity')]
    depths = [r.get('depth') for r in reps_data if r.get('depth')]

    new_set = Set(
        workout_id=workout_id,
        set_number=set_number,
        reps_completed=data.get('reps_completed', len(reps_data)),
        avg_depth=sum(depths) / len(depths) if depths else None,
        avg_velocity=sum(velocities) / len(velocities) if velocities else None,
        min_velocity=min(velocities) if velocities else None,
        max_velocity=max(velocities) if velocities else None,
        fatigue_drop=data.get('fatigue_drop')
    )
    db.session.add(new_set)
    db.session.flush()  # Get the set ID

    # Add individual reps
    for i, rep_data in enumerate(reps_data):
        rep = Rep(
            set_id=new_set.id,
            rep_number=i + 1,
            depth=rep_data.get('depth'),
            time_seconds=rep_data.get('time_seconds'),
            velocity=rep_data.get('velocity'),
            quality=rep_data.get('quality')
        )
        db.session.add(rep)

    db.session.commit()

    print(f"✅ Set {set_number} added to workout for {current_user.email}: {new_set.reps_completed} reps")
    return jsonify({'success': True, 'set': new_set.to_dict()}), 201


@app.route('/api/workouts/<int:workout_id>/sets/<int:set_id>', methods=['DELETE'])
@login_required
def delete_set(workout_id, set_id):
    """Delete a specific set"""
    workout = Workout.query.filter_by(id=workout_id, user_id=current_user.id).first()
    if not workout:
        return jsonify({'error': 'Workout not found'}), 404

    set_to_delete = Set.query.filter_by(id=set_id, workout_id=workout_id).first()
    if not set_to_delete:
        return jsonify({'error': 'Set not found'}), 404

    db.session.delete(set_to_delete)
    db.session.commit()

    return jsonify({'success': True})


@app.route('/api/workouts/current', methods=['GET'])
@login_required
def get_current_workout():
    """Get the most recent incomplete workout, or create a new one"""
    workout = Workout.query.filter_by(
        user_id=current_user.id,
        completed_at=None
    ).order_by(Workout.created_at.desc()).first()

    if workout:
        return jsonify({'success': True, 'workout': workout.to_dict()})
    else:
        return jsonify({'success': True, 'workout': None})


@app.route('/api/stats', methods=['GET'])
@login_required
def get_stats():
    """Get user's overall workout statistics"""
    total_workouts = Workout.query.filter_by(user_id=current_user.id).count()
    total_sets = db.session.query(Set).join(Workout).filter(Workout.user_id == current_user.id).count()
    total_reps = db.session.query(db.func.sum(Set.reps_completed)).join(Workout).filter(Workout.user_id == current_user.id).scalar() or 0

    # Get recent velocity trend (last 10 sets)
    recent_sets = db.session.query(Set).join(Workout)\
        .filter(Workout.user_id == current_user.id)\
        .order_by(Set.created_at.desc())\
        .limit(10).all()

    avg_velocity = None
    if recent_sets:
        velocities = [s.avg_velocity for s in recent_sets if s.avg_velocity]
        if velocities:
            avg_velocity = sum(velocities) / len(velocities)

    return jsonify({
        'success': True,
        'stats': {
            'total_workouts': total_workouts,
            'total_sets': total_sets,
            'total_reps': total_reps,
            'avg_velocity': round(avg_velocity) if avg_velocity else None
        }
    })


# ========== Coach Dashboard & Routes ==========

@app.route('/coach')
@login_required
def coach_dashboard():
    """Coach dashboard showing athletes and their stats"""
    if not current_user.is_coach:
        return redirect(url_for('dashboard'))
    return render_template('coach_dashboard.html')


@app.route('/api/coach/athletes', methods=['GET'])
@login_required
@coach_required
def get_coach_athletes():
    """Get all athletes assigned to this coach"""
    athletes = User.query.filter_by(coach_id=current_user.id).all()
    athlete_data = []
    for athlete in athletes:
        # Get athlete stats
        total_workouts = Workout.query.filter_by(user_id=athlete.id).count()
        total_sets = db.session.query(Set).join(Workout).filter(Workout.user_id == athlete.id).count()

        # Recent velocity
        recent_sets = db.session.query(Set).join(Workout)\
            .filter(Workout.user_id == athlete.id)\
            .order_by(Set.created_at.desc()).limit(5).all()
        avg_velocity = None
        if recent_sets:
            velocities = [s.avg_velocity for s in recent_sets if s.avg_velocity]
            if velocities:
                avg_velocity = sum(velocities) / len(velocities)

        athlete_data.append({
            'id': athlete.id,
            'email': athlete.email,
            'name': athlete.get_display_name(),
            'total_workouts': total_workouts,
            'total_sets': total_sets,
            'avg_velocity': round(avg_velocity) if avg_velocity else None,
            'last_login': athlete.last_login.isoformat() if athlete.last_login else None
        })

    return jsonify({'success': True, 'athletes': athlete_data})


@app.route('/api/coach/athletes/<int:athlete_id>', methods=['GET'])
@login_required
@coach_required
def get_athlete_details(athlete_id):
    """Get detailed info for a specific athlete"""
    athlete = User.query.filter_by(id=athlete_id, coach_id=current_user.id).first()
    if not athlete:
        return jsonify({'error': 'Athlete not found'}), 404

    # Get recent workouts
    workouts = Workout.query.filter_by(user_id=athlete.id)\
        .order_by(Workout.created_at.desc()).limit(10).all()

    # Get programs
    programs = Program.query.filter_by(athlete_id=athlete.id, coach_id=current_user.id)\
        .order_by(Program.created_at.desc()).all()

    return jsonify({
        'success': True,
        'athlete': {
            'id': athlete.id,
            'email': athlete.email,
            'name': athlete.get_display_name(),
            'height': athlete.height,
            'created_at': athlete.created_at.isoformat() if athlete.created_at else None,
            'last_login': athlete.last_login.isoformat() if athlete.last_login else None
        },
        'workouts': [w.to_dict() for w in workouts],
        'programs': [p.to_dict(include_days=False) for p in programs]
    })


@app.route('/api/coach/add-athlete', methods=['POST'])
@login_required
@coach_required
def add_athlete():
    """Add an athlete to this coach (by email)"""
    data = request.get_json()
    email = data.get('email', '').lower().strip()

    if not email:
        return jsonify({'error': 'Email required'}), 400

    athlete = User.query.filter_by(email=email).first()
    if not athlete:
        return jsonify({'error': 'User not found'}), 404

    if athlete.is_coach:
        return jsonify({'error': 'Cannot add a coach as athlete'}), 400

    if athlete.coach_id:
        return jsonify({'error': 'Athlete already has a coach'}), 400

    athlete.coach_id = current_user.id
    db.session.commit()

    print(f"✅ Athlete {email} added to coach {current_user.email}")
    return jsonify({'success': True, 'message': f'{athlete.get_display_name()} added as athlete'})


@app.route('/api/coach/remove-athlete/<int:athlete_id>', methods=['DELETE'])
@login_required
@coach_required
def remove_athlete(athlete_id):
    """Remove an athlete from this coach"""
    athlete = User.query.filter_by(id=athlete_id, coach_id=current_user.id).first()
    if not athlete:
        return jsonify({'error': 'Athlete not found'}), 404

    athlete.coach_id = None
    db.session.commit()

    return jsonify({'success': True})


# ========== Coach Invitation Routes ==========

@app.route('/api/coach/invites', methods=['GET'])
@login_required
@coach_required
def get_coach_invites():
    """Get all invitations sent by this coach"""
    invites = CoachInvite.query.filter_by(coach_id=current_user.id).order_by(CoachInvite.created_at.desc()).all()
    return jsonify({'success': True, 'invites': [i.to_dict() for i in invites]})


@app.route('/api/coach/invite', methods=['POST'])
@login_required
@coach_required
def create_invite():
    """Create a new invitation for an athlete"""
    import secrets

    data = request.get_json()
    email = data.get('email', '').lower().strip()

    if not email:
        return jsonify({'error': 'Email required'}), 400

    # Check if user already exists and is already linked to this coach
    existing_user = User.query.filter_by(email=email).first()
    if existing_user and existing_user.coach_id == current_user.id:
        return jsonify({'error': 'This athlete is already linked to you'}), 400

    # Check if there's already a pending invite for this email from this coach
    existing_invite = CoachInvite.query.filter_by(
        coach_id=current_user.id,
        email=email,
        status='pending'
    ).first()

    if existing_invite:
        # Return the existing invite
        return jsonify({
            'success': True,
            'invite': existing_invite.to_dict(),
            'invite_url': url_for('join_via_invite', token=existing_invite.token, _external=True),
            'message': 'Invite already exists'
        })

    # Create new invite
    token = secrets.token_urlsafe(32)
    invite = CoachInvite(
        coach_id=current_user.id,
        email=email,
        token=token
    )
    db.session.add(invite)
    db.session.commit()

    invite_url = url_for('join_via_invite', token=token, _external=True)

    print(f"✅ Invite created by {current_user.email} for {email}")
    return jsonify({
        'success': True,
        'invite': invite.to_dict(),
        'invite_url': invite_url
    }), 201


@app.route('/api/coach/invites/<int:invite_id>', methods=['DELETE'])
@login_required
@coach_required
def delete_invite(invite_id):
    """Delete/cancel an invitation"""
    invite = CoachInvite.query.filter_by(id=invite_id, coach_id=current_user.id).first()
    if not invite:
        return jsonify({'error': 'Invite not found'}), 404

    db.session.delete(invite)
    db.session.commit()

    return jsonify({'success': True})


@app.route('/join/<token>')
def join_via_invite(token):
    """Public page for athlete to join via invite link"""
    invite = CoachInvite.query.filter_by(token=token, status='pending').first()
    if not invite:
        return render_template('join.html', error='Invalid or expired invitation link')

    coach = User.query.get(invite.coach_id)
    return render_template('join.html', invite=invite, coach=coach)


@app.route('/join/<token>', methods=['POST'])
def process_join_invite(token):
    """Process athlete registration via invite"""
    invite = CoachInvite.query.filter_by(token=token, status='pending').first()
    if not invite:
        return jsonify({'error': 'Invalid or expired invitation link'}), 400

    data = request.get_json()
    email = data.get('email', '').lower().strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400

    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    # Check if user already exists
    existing_user = User.query.filter_by(email=email).first()

    if existing_user:
        # Verify it's the same email as the invite, or allow different email
        if existing_user.coach_id and existing_user.coach_id != invite.coach_id:
            return jsonify({'error': 'This account already has a different coach'}), 400

        # Link existing user to coach
        existing_user.coach_id = invite.coach_id
        existing_user.subscribed = True
        existing_user.subscription_type = 'coach'
        db.session.commit()

        # Update invite
        invite.status = 'accepted'
        invite.accepted_at = datetime.utcnow()
        invite.athlete_id = existing_user.id
        db.session.commit()

        login_user(existing_user, remember=True)
        print(f"✅ Existing user {email} joined coach {invite.coach.email}")
        return jsonify({'success': True, 'redirect': url_for('dashboard')})

    # Create new user
    user = User(
        email=email,
        subscribed=True,
        subscription_type='coach',
        coach_id=invite.coach_id
    )
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    # Update invite
    invite.status = 'accepted'
    invite.accepted_at = datetime.utcnow()
    invite.athlete_id = user.id
    db.session.commit()

    login_user(user, remember=True)
    print(f"✅ New user {email} created and joined coach {invite.coach.email}")
    return jsonify({'success': True, 'redirect': url_for('dashboard')})


# ========== Program Routes ==========

@app.route('/programs')
@login_required
def programs_page():
    """Programs page for users to view their assigned programs"""
    return render_template('programs.html')


@app.route('/api/programs', methods=['GET'])
@login_required
def get_programs():
    """Get programs for the current user (as athlete or coach-created)"""
    if current_user.is_coach:
        # Coaches see programs they've created
        programs = Program.query.filter_by(coach_id=current_user.id)\
            .order_by(Program.created_at.desc()).all()
    else:
        # Athletes see programs assigned to them
        programs = Program.query.filter_by(athlete_id=current_user.id)\
            .order_by(Program.created_at.desc()).all()

    return jsonify({'success': True, 'programs': [p.to_dict(include_days=False) for p in programs]})


@app.route('/api/programs', methods=['POST'])
@login_required
def create_program():
    """Create a new program"""
    data = request.get_json()

    if current_user.is_coach:
        # Coach creating for an athlete
        athlete_id = data.get('athlete_id')
        if not athlete_id:
            return jsonify({'error': 'athlete_id required'}), 400

        athlete = User.query.filter_by(id=athlete_id, coach_id=current_user.id).first()
        if not athlete:
            return jsonify({'error': 'Athlete not found'}), 404

        program = Program(
            coach_id=current_user.id,
            athlete_id=athlete_id,
            name=data.get('name', 'Training Program'),
            description=data.get('description')
        )
    else:
        # User creating for themselves
        program = Program(
            coach_id=None,
            athlete_id=current_user.id,
            name=data.get('name', 'My Program'),
            description=data.get('description')
        )

    db.session.add(program)
    db.session.commit()

    print(f"✅ Program '{program.name}' created by {current_user.email}")
    return jsonify({'success': True, 'program': program.to_dict()}), 201


@app.route('/api/programs/<int:program_id>', methods=['GET'])
@login_required
def get_program(program_id):
    """Get a specific program with all details"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'error': 'Program not found'}), 404

    # Check access
    if program.athlete_id != current_user.id and program.coach_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    return jsonify({'success': True, 'program': program.to_dict()})


@app.route('/api/programs/<int:program_id>', methods=['PUT'])
@login_required
def update_program(program_id):
    """Update a program"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'error': 'Program not found'}), 404

    # Only coach or self-created can edit
    if program.coach_id and program.coach_id != current_user.id:
        return jsonify({'error': 'Only the coach can edit this program'}), 403
    if not program.coach_id and program.athlete_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if 'name' in data:
        program.name = data['name']
    if 'description' in data:
        program.description = data['description']
    if 'is_active' in data:
        program.is_active = data['is_active']

    db.session.commit()
    return jsonify({'success': True, 'program': program.to_dict()})


@app.route('/api/programs/<int:program_id>', methods=['DELETE'])
@login_required
def delete_program(program_id):
    """Delete a program"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'error': 'Program not found'}), 404

    # Only coach or self-created can delete
    if program.coach_id and program.coach_id != current_user.id:
        return jsonify({'error': 'Only the coach can delete this program'}), 403
    if not program.coach_id and program.athlete_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(program)
    db.session.commit()
    return jsonify({'success': True})


# ========== Program Day Routes ==========

@app.route('/api/programs/<int:program_id>/days', methods=['POST'])
@login_required
def add_program_day(program_id):
    """Add a day to a program"""
    program = Program.query.get(program_id)
    if not program:
        return jsonify({'error': 'Program not found'}), 404

    # Check write access
    can_edit = (program.coach_id == current_user.id) or \
               (not program.coach_id and program.athlete_id == current_user.id)
    if not can_edit:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    last_day = ProgramDay.query.filter_by(program_id=program_id)\
        .order_by(ProgramDay.day_number.desc()).first()
    day_number = (last_day.day_number + 1) if last_day else 1

    day = ProgramDay(
        program_id=program_id,
        day_number=day_number,
        name=data.get('name', f'Day {day_number}'),
        notes=data.get('notes')
    )
    db.session.add(day)
    db.session.commit()

    return jsonify({'success': True, 'day': day.to_dict()}), 201


@app.route('/api/programs/<int:program_id>/days/<int:day_id>', methods=['PUT'])
@login_required
def update_program_day(program_id, day_id):
    """Update a program day"""
    day = ProgramDay.query.filter_by(id=day_id, program_id=program_id).first()
    if not day:
        return jsonify({'error': 'Day not found'}), 404

    program = day.program
    can_edit = (program.coach_id == current_user.id) or \
               (not program.coach_id and program.athlete_id == current_user.id)
    if not can_edit:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if 'name' in data:
        day.name = data['name']
    if 'notes' in data:
        day.notes = data['notes']

    db.session.commit()
    return jsonify({'success': True, 'day': day.to_dict()})


@app.route('/api/programs/<int:program_id>/days/<int:day_id>', methods=['DELETE'])
@login_required
def delete_program_day(program_id, day_id):
    """Delete a program day"""
    day = ProgramDay.query.filter_by(id=day_id, program_id=program_id).first()
    if not day:
        return jsonify({'error': 'Day not found'}), 404

    program = day.program
    can_edit = (program.coach_id == current_user.id) or \
               (not program.coach_id and program.athlete_id == current_user.id)
    if not can_edit:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(day)
    db.session.commit()
    return jsonify({'success': True})


# ========== Program Exercise Routes ==========

@app.route('/api/program-days/<int:day_id>/exercises', methods=['POST'])
@login_required
def add_exercise(day_id):
    """Add an exercise to a program day"""
    day = ProgramDay.query.get(day_id)
    if not day:
        return jsonify({'error': 'Day not found'}), 404

    program = day.program
    can_edit = (program.coach_id == current_user.id) or \
               (not program.coach_id and program.athlete_id == current_user.id)
    if not can_edit:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    last_ex = ProgramExercise.query.filter_by(program_day_id=day_id)\
        .order_by(ProgramExercise.order.desc()).first()
    order = (last_ex.order + 1) if last_ex else 0

    exercise = ProgramExercise(
        program_day_id=day_id,
        name=data.get('name', 'Exercise'),
        sets_prescribed=data.get('sets_prescribed', 3),
        reps_prescribed=data.get('reps_prescribed', '8-10'),
        weight_prescribed=data.get('weight_prescribed'),
        notes=data.get('notes'),
        order=order,
        exercise_type=data.get('exercise_type', 'standard')
    )

    # Only coaches can set video URLs
    if current_user.is_coach and data.get('video_url'):
        exercise.video_url = data['video_url']

    db.session.add(exercise)
    db.session.commit()

    return jsonify({'success': True, 'exercise': exercise.to_dict()}), 201


@app.route('/api/exercises/<int:exercise_id>', methods=['PUT'])
@login_required
def update_exercise(exercise_id):
    """Update an exercise"""
    exercise = ProgramExercise.query.get(exercise_id)
    if not exercise:
        return jsonify({'error': 'Exercise not found'}), 404

    program = exercise.day.program
    can_edit = (program.coach_id == current_user.id) or \
               (not program.coach_id and program.athlete_id == current_user.id)
    if not can_edit:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    for field in ['name', 'sets_prescribed', 'reps_prescribed', 'weight_prescribed', 'notes', 'order', 'exercise_type']:
        if field in data:
            setattr(exercise, field, data[field])

    # Only coaches can set video URLs
    if current_user.is_coach and 'video_url' in data:
        exercise.video_url = data['video_url']

    db.session.commit()
    return jsonify({'success': True, 'exercise': exercise.to_dict()})


@app.route('/api/exercises/<int:exercise_id>', methods=['DELETE'])
@login_required
def delete_exercise(exercise_id):
    """Delete an exercise"""
    exercise = ProgramExercise.query.get(exercise_id)
    if not exercise:
        return jsonify({'error': 'Exercise not found'}), 404

    program = exercise.day.program
    can_edit = (program.coach_id == current_user.id) or \
               (not program.coach_id and program.athlete_id == current_user.id)
    if not can_edit:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(exercise)
    db.session.commit()
    return jsonify({'success': True})


# ========== Program Set Log Routes ==========

@app.route('/api/exercises/<int:exercise_id>/log', methods=['POST'])
@login_required
def log_set(exercise_id):
    """Log a completed set for an exercise"""
    exercise = ProgramExercise.query.get(exercise_id)
    if not exercise:
        return jsonify({'error': 'Exercise not found'}), 404

    program = exercise.day.program
    # Only the athlete can log sets
    if program.athlete_id != current_user.id:
        return jsonify({'error': 'Only the athlete can log sets'}), 403

    data = request.get_json()

    # Get next set number
    last_log = ProgramSetLog.query.filter_by(
        program_exercise_id=exercise_id,
        user_id=current_user.id
    ).order_by(ProgramSetLog.set_number.desc()).first()
    set_number = data.get('set_number', (last_log.set_number + 1) if last_log else 1)

    log = ProgramSetLog(
        program_exercise_id=exercise_id,
        user_id=current_user.id,
        set_number=set_number,
        reps_completed=data.get('reps_completed'),
        weight=data.get('weight'),
        weight_unit=data.get('weight_unit', 'lbs'),
        rpe=data.get('rpe'),
        notes=data.get('notes'),
        velocity_tracked=data.get('velocity_tracked', False),
        workout_set_id=data.get('workout_set_id')
    )
    db.session.add(log)
    db.session.commit()

    return jsonify({'success': True, 'log': log.to_dict()}), 201


@app.route('/api/exercises/<int:exercise_id>/log/<int:log_id>', methods=['PUT'])
@login_required
def update_set_log(exercise_id, log_id):
    """Update a logged set"""
    log = ProgramSetLog.query.filter_by(id=log_id, program_exercise_id=exercise_id).first()
    if not log:
        return jsonify({'error': 'Log not found'}), 404

    if log.user_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    for field in ['reps_completed', 'weight', 'weight_unit', 'rpe', 'notes']:
        if field in data:
            setattr(log, field, data[field])

    db.session.commit()
    return jsonify({'success': True, 'log': log.to_dict()})


@app.route('/api/exercises/<int:exercise_id>/log/<int:log_id>', methods=['DELETE'])
@login_required
def delete_set_log(exercise_id, log_id):
    """Delete a logged set"""
    log = ProgramSetLog.query.filter_by(id=log_id, program_exercise_id=exercise_id).first()
    if not log:
        return jsonify({'error': 'Log not found'}), 404

    if log.user_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(log)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/exercises/<int:exercise_id>/logs', methods=['GET'])
@login_required
def get_exercise_logs(exercise_id):
    """Get all logs for an exercise"""
    exercise = ProgramExercise.query.get(exercise_id)
    if not exercise:
        return jsonify({'error': 'Exercise not found'}), 404

    program = exercise.day.program
    # Check access
    if program.athlete_id != current_user.id and program.coach_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    # Filter by user if athlete, show all if coach
    if current_user.is_coach:
        logs = ProgramSetLog.query.filter_by(program_exercise_id=exercise_id)\
            .order_by(ProgramSetLog.created_at.desc()).all()
    else:
        logs = ProgramSetLog.query.filter_by(
            program_exercise_id=exercise_id,
            user_id=current_user.id
        ).order_by(ProgramSetLog.created_at.desc()).all()

    return jsonify({'success': True, 'logs': [l.to_dict() for l in logs]})


# ========== Velocity Tracked Set Management ==========

@app.route('/api/sets/<int:set_id>/reps', methods=['POST'])
@login_required
def add_rep_to_set(set_id):
    """Add a rep to an existing set (non-velocity)"""
    workout_set = Set.query.get(set_id)
    if not workout_set:
        return jsonify({'error': 'Set not found'}), 404

    workout = workout_set.workout
    if workout.user_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()

    # Get next rep number
    last_rep = Rep.query.filter_by(set_id=set_id).order_by(Rep.rep_number.desc()).first()
    rep_number = (last_rep.rep_number + 1) if last_rep else 1

    # Add rep without velocity (velocity must come from tracker)
    rep = Rep(
        set_id=set_id,
        rep_number=rep_number,
        depth=data.get('depth'),
        quality=data.get('quality')
        # Note: time_seconds and velocity are NOT settable manually
    )
    db.session.add(rep)

    # Update set stats
    workout_set.reps_completed = workout_set.reps.count() + 1
    db.session.commit()

    # Recalculate averages
    reps = workout_set.reps.all()
    depths = [r.depth for r in reps if r.depth]
    velocities = [r.velocity for r in reps if r.velocity]
    workout_set.avg_depth = sum(depths) / len(depths) if depths else None
    workout_set.avg_velocity = sum(velocities) / len(velocities) if velocities else None
    workout_set.min_velocity = min(velocities) if velocities else None
    workout_set.max_velocity = max(velocities) if velocities else None
    db.session.commit()

    return jsonify({'success': True, 'rep': rep.to_dict(), 'set': workout_set.to_dict()}), 201


@app.route('/api/sets/<int:set_id>/reps/<int:rep_id>', methods=['DELETE'])
@login_required
def delete_rep_from_set(set_id, rep_id):
    """Delete a rep from a set"""
    workout_set = Set.query.get(set_id)
    if not workout_set:
        return jsonify({'error': 'Set not found'}), 404

    workout = workout_set.workout
    if workout.user_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    rep = Rep.query.filter_by(id=rep_id, set_id=set_id).first()
    if not rep:
        return jsonify({'error': 'Rep not found'}), 404

    db.session.delete(rep)

    # Update set stats
    workout_set.reps_completed = max(0, workout_set.reps_completed - 1)
    db.session.commit()

    # Recalculate averages
    reps = workout_set.reps.all()
    if reps:
        depths = [r.depth for r in reps if r.depth]
        velocities = [r.velocity for r in reps if r.velocity]
        workout_set.avg_depth = sum(depths) / len(depths) if depths else None
        workout_set.avg_velocity = sum(velocities) / len(velocities) if velocities else None
        workout_set.min_velocity = min(velocities) if velocities else None
        workout_set.max_velocity = max(velocities) if velocities else None
    else:
        workout_set.avg_depth = None
        workout_set.avg_velocity = None
        workout_set.min_velocity = None
        workout_set.max_velocity = None

    db.session.commit()

    return jsonify({'success': True, 'set': workout_set.to_dict()})


# ========== Enhanced Stats & Dashboard Customization ==========

@app.route('/api/dashboard/metrics', methods=['GET'])
@login_required
def get_dashboard_metrics():
    """Get customizable dashboard metrics for the user"""
    metrics = current_user.get_dashboard_metrics()

    # Get available metrics based on logged exercises
    logs = db.session.query(ProgramSetLog.program_exercise_id)\
        .filter(ProgramSetLog.user_id == current_user.id)\
        .distinct().all()

    available_metrics = set()
    for (ex_id,) in logs:
        ex = ProgramExercise.query.get(ex_id)
        if ex:
            available_metrics.add(ex.name.lower())

    # Add default metrics
    available_metrics.update(['squat', 'bench', 'deadlift', 'vertical', 'rsi'])

    return jsonify({
        'success': True,
        'selected_metrics': metrics,
        'available_metrics': sorted(list(available_metrics))
    })


@app.route('/api/dashboard/metrics', methods=['PUT'])
@login_required
def update_dashboard_metrics():
    """Update the user's dashboard metrics selection"""
    data = request.get_json()
    metrics = data.get('metrics', [])

    if not isinstance(metrics, list):
        return jsonify({'error': 'metrics must be a list'}), 400

    if len(metrics) < 3:
        return jsonify({'error': 'Select at least 3 metrics'}), 400
    if len(metrics) > 6:
        return jsonify({'error': 'Maximum 6 metrics allowed'}), 400

    current_user.set_dashboard_metrics(metrics)
    db.session.commit()

    return jsonify({'success': True, 'metrics': current_user.get_dashboard_metrics()})


@app.route('/api/dashboard/lift-stats', methods=['GET'])
@login_required
def get_lift_stats():
    """Get comprehensive lift statistics for dashboard"""
    stats = {}

    # Get all exercises the user has logged
    exercise_names = db.session.query(ProgramExercise.name)\
        .join(ProgramSetLog, ProgramExercise.id == ProgramSetLog.program_exercise_id)\
        .filter(ProgramSetLog.user_id == current_user.id)\
        .distinct().all()

    for (name,) in exercise_names:
        # Get logs for this exercise
        logs = ProgramSetLog.query.join(ProgramExercise)\
            .filter(
                ProgramExercise.name == name,
                ProgramSetLog.user_id == current_user.id
            ).order_by(ProgramSetLog.created_at.desc()).all()

        if logs:
            weights = [l.weight for l in logs if l.weight]
            velocities = []
            for l in logs:
                if l.velocity_tracked and l.workout_set:
                    if l.workout_set.avg_velocity:
                        velocities.append(l.workout_set.avg_velocity)

            stats[name.lower()] = {
                'name': name,
                'total_sets': len(logs),
                'max_weight': max(weights) if weights else None,
                'recent_weight': weights[0] if weights else None,
                'avg_velocity': round(sum(velocities) / len(velocities)) if velocities else None,
                'last_logged': logs[0].created_at.isoformat() if logs else None
            }

    # Add squat velocity from workouts if not in programs
    if 'squat' not in stats:
        squat_sets = db.session.query(Set).join(Workout)\
            .filter(Workout.user_id == current_user.id)\
            .order_by(Set.created_at.desc()).limit(50).all()

        if squat_sets:
            velocities = [s.avg_velocity for s in squat_sets if s.avg_velocity]
            stats['squat'] = {
                'name': 'Squat',
                'total_sets': len(squat_sets),
                'max_weight': None,
                'recent_weight': None,
                'avg_velocity': round(sum(velocities) / len(velocities)) if velocities else None,
                'last_logged': squat_sets[0].created_at.isoformat() if squat_sets else None
            }

    return jsonify({'success': True, 'stats': stats})


@app.route('/api/user/profile', methods=['PUT'])
@login_required
def update_profile():
    """Update user profile"""
    data = request.get_json()

    if 'name' in data:
        current_user.name = data['name']
    if 'height' in data:
        current_user.height = data['height']

    db.session.commit()
    return jsonify({
        'success': True,
        'user': {
            'name': current_user.name,
            'email': current_user.email,
            'height': current_user.height
        }
    })


@app.route('/tests')
def run_tests():
    if not app.debug:
        return "Tests only available in development mode", 403
    return app.send_static_file('tests/test-runner.html')


if __name__ == '__main__':
    app.run(debug=True)
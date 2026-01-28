from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
import stripe
import os
from dotenv import load_dotenv
from datetime import datetime
import jinja2

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
# Database Models
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    subscribed = db.Column(db.Boolean, default=False)
    stripe_customer_id = db.Column(db.String(255), nullable=True)
    subscription_type = db.Column(db.String(50), nullable=True)  # 'monthly' or 'annual'
    subscription_end_date = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)
    height = db.Column(db.Integer, default=58)  # Default height in inches
    needs_password_setup = db.Column(db.Boolean, default=False)  # NEW: Flag for users created via payment

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


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


# Create tables
with app.app_context():
    db.create_all()

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

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
            
            redirect_url = url_for('tracker') if user.subscribed else url_for('subscribe')
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
    return render_template('tracker.html', height=current_user.height)

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
    # If user is already subscribed, redirect to tracker
    if current_user.subscribed:
        return redirect(url_for('tracker'))
    
    if request.method == 'POST':
        data = request.get_json()
        code = data.get('code', '').strip()
        
        if not code:
            return jsonify({'error': 'Code required'}), 400
        
        # Check if code matches
        if code.upper() == ACCESS_CODE:
            # Grant lifetime access
            current_user.subscribed = True
            current_user.subscription_type = 'lifetime'
            db.session.commit()
            
            print(f"✅ Lifetime access granted to {current_user.email} via access code")
            return jsonify({'success': True, 'message': 'Access granted!'})
        else:
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


if __name__ == '__main__':
    app.run(debug=True)
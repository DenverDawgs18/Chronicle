from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import stripe
import os
from dotenv import load_dotenv
from datetime import datetime

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
    needs_password_setup = db.Column(db.Boolean, default=False)  # NEW: Flag for users created via payment

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

# Create tables
with app.app_context():
    db.create_all()

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

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
    return render_template('tracker.html')

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

if __name__ == '__main__':
    app.run(debug=True)
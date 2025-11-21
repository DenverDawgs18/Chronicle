from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import stripe
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
DATABASE_URL = os.getenv('DATABASE_URL')
if DATABASE_URL and DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    print(f"Fixed DATABASE_URL scheme: {DATABASE_URL[:50]}...")
    app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
WEBHOOK_SECRET = os.getenv('STRIPE_WEBHOOK_SECRET')

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    paid = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, server_default=db.func.now())



with app.app_context():
    db.create_all()



@app.route('/')
def index():
    return render_template('index.html')

@app.route('/webhook', methods=['POST'])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get('Stripe-Signature')
    try:
        event = stripe.Webhook.construct_event(
                payload, 
                sig_header, 
                WEBHOOK_SECRET,
            )
    except Exception as e:
        print(f"Webhook signature verification failed: {e}")
        return "Bad signature", 400
    try:        
        # Handle successful payment
        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            email = session['customer_details']['email'].lower()
            
            # Create or update user
            user = User.query.filter_by(email=email).first()
            if user:
                user.paid = True
            else:
                user = User(email=email, paid=True)
                db.session.add(user)
            
            db.session.commit()
            print(f"✅ Payment recorded for {email}")

            
        return render_template("index.html")
        
    except Exception as e:
        print(f"❌ Webhook error: {e}")
        return jsonify({'error': 'Invalid payload'}), 400

@app.route('/check-access', methods=['GET'])
def check_access():
    email = request.args.get('email', '').lower().strip()
    
    if not email:
        return jsonify({'paid': False, 'error': 'Email required'}), 400
    
    user = User.query.filter_by(email=email).first()

    is_paid = user and user.paid
    print(is_paid)
    
    return jsonify({'paid': is_paid, 'email': email})


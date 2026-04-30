import os
from flask import Flask, render_template, send_from_directory, request, jsonify
from flask_mail import Mail, Message
import string
import random
import traceback
import threading
import time
import requests
from datetime import datetime, timedelta

app = Flask(__name__)

# ---------- Flask-Mail Config ----------
# Replace these with your actual email settings (e.g., using a Google App Password)
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME', 'hehehahapoochi08@gmail.com')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD', 'kmkqvjescptkenlk') # Use App Password without spaces
app.config['MAIL_DEFAULT_SENDER'] = app.config['MAIL_USERNAME']

# --- SIMULATION MODE ---
# Set to True to bypass real email sending (useful for testing/demo)
# Set to False once you have valid SMTP credentials
MAIL_DEBUG_MODE = False 

mail = Mail(app)

# ---------- MFA & Restricted Access State ----------
# In-memory store for verification requests
# Format: { request_id: { "email": email, "verified": False, "expires": timestamp } }
verification_requests = {}

# ---------- Supabase Config for Background Automation ----------
SUPABASE_URL = "https://ctoybxukmkcnwdeueorm.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0b3lieHVrbWtjbndkZXVlb3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODg3NzAsImV4cCI6MjA4ODM2NDc3MH0.hLDzyCvNzWbrXW-5Z1NsE6eH2sF_3S5L33htZYjEiH0"

# Background automation for reminders removed as requested.


# Utility to generate temporary password
def generate_password(length=8):
    chars = string.ascii_letters + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

# ---------- Pages ----------
@app.route("/")
def login():
    return render_template("login.html")


@app.route("/admin")
def admin_portal():
    return render_template("index.html")


@app.route("/qr-attendance")
def qr_attendance():
    return render_template("qr_attendance.html")


@app.route("/nurse")
def nurse_portal():
    return render_template("nurse.html")


@app.route("/application-form")
def application_form():
    return render_template("application_form.html")


@app.route("/verification-success")
def verification_success():
    return render_template("verification_success.html")



# ---------- Root-level asset shortcuts ----------

# The template references styles.css, app.js, and ic_clinic_logo.png
# at the root.  Map them to the real locations inside static/.

@app.route("/styles.css")
def root_styles():
    return send_from_directory(os.path.join(app.static_folder, "css"), "styles.css")


@app.route("/app.js")
def root_appjs():
    return send_from_directory(os.path.join(app.static_folder, "js"), "app.js")


@app.route("/nurse.css")
def nurse_css():
    return send_from_directory(os.path.join(app.static_folder, "css"), "nurse.css")


@app.route("/nurse.js")
def nurse_js():
    return send_from_directory(os.path.join(app.static_folder, "js"), "nurse.js")


@app.route("/ic_clinic_logo.png")
def root_logo():
    return send_from_directory(os.path.join(app.static_folder, "images"), "ic_clinic_logo.png")


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(os.path.join(app.static_folder, "images"), "ic_clinic_logo.png",
                               mimetype="image/png")


@app.route("/vendor/<path:filename>")
def vendor_files(filename):
    return send_from_directory(os.path.join(app.static_folder, "vendor"), filename)


# ---------- Recruitment API ----------

@app.route("/api/recruitment/interview", methods=["POST"])
def send_interview_email():
    data = request.json
    email = data.get("email")
    name = data.get("name")
    date = data.get("date")
    time = data.get("time")
    location = data.get("location", "OrthoConnect Clinic")

    if not email or not name:
        return jsonify({"error": "Missing essential info"}), 400

    try:
        msg = Message("Interview Invitation - OrthoConnect Recruitment",
                      recipients=[email])
        msg.body = f"""
        Dear {name},

        We are pleased to invite you for an interview at OrthoConnect Orthodontic Clinic.

        Schedule:
        Date: {date}
        Time: {time}
        Location: {location}

        Please confirm your availability by replying to this email.

        Best regards,
        OrthoConnect HR Team
        """
        
        if MAIL_DEBUG_MODE:
            print("--- SIMULATED INTERVIEW EMAIL ---")
            print(f"To: {email}")
            print(f"Body: {msg.body}")
            print("---------------------------------")
        else:
            mail.send(msg)

        return jsonify({"success": True, "message": "Interview email sent (Simulated)!" if MAIL_DEBUG_MODE else "Interview email sent!"})
    except Exception as e:
        print("------- EMAIL ERROR TRACEBACK -------")
        traceback.print_exc()
        print("-------------------------------------")
        return jsonify({"error": f"Email service error: {str(e)}. Please check your SMTP credentials in app.py."}), 500


@app.route("/api/recruitment/hire", methods=["POST"])
def send_hiring_email():
    data = request.json
    email = data.get("email")
    name = data.get("name")
    role = data.get("role", "Nurse")
    password = data.get("password") or generate_password()

    if not email:
        return jsonify({"error": "Missing email"}), 400

    try:
        msg = Message("Congratulations! You are Hired - OrthoConnect Clinic",
                      recipients=[email])
        msg.html = f"""
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background-color: #f8fafc; border-radius: 32px;">
            <div style="background-color: white; padding: 48px; border-radius: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.05); border: 1px solid #eef2f6;">
                <div style="text-align: center; margin-bottom: 40px;">
                    <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #0d9488, #0f766e); border-radius: 24px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 24px; box-shadow: 0 10px 20px rgba(13, 148, 136, 0.2);">
                        <span style="color: white; font-size: 40px; font-weight: 900;">+</span>
                    </div>
                    <h1 style="color: #1e293b; font-size: 28px; font-weight: 900; margin: 0; letter-spacing: -1px;">Congratulations!</h1>
                    <p style="color: #64748b; font-size: 16px; font-weight: 600; margin-top: 8px; text-transform: uppercase; letter-spacing: 2px;">Welcome to the Team</p>
                </div>
                
                <p style="color: #475569; font-size: 16px; line-height: 26px; margin-bottom: 32px;">
                    Dear <b>{name}</b>,<br><br>
                    We are thrilled to officially welcome you to <b>OrthoConnect Orthodontic Clinic</b> as our newest <b>{role}</b>. Your expertise and passion stood out, and we are excited to have you onboard.
                </p>
                
                <div style="background-color: #f1f5f9; padding: 24px; border-radius: 24px; margin-bottom: 32px; border: 1px dashed #cbd5e1;">
                    <p style="color: #64748b; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px;">Your Login Credentials</p>
                    <div style="margin-bottom: 12px;">
                        <span style="color: #94a3b8; font-size: 14px; font-weight: 600;">Portal:</span>
                        <span style="color: #1e293b; font-size: 14px; font-weight: 700; float: right;">{request.url_root}nurse</span>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <span style="color: #94a3b8; font-size: 14px; font-weight: 600;">Gmail:</span>
                        <span style="color: #1e293b; font-size: 14px; font-weight: 700; float: right;">{email}</span>
                    </div>
                    <div>
                        <span style="color: #94a3b8; font-size: 14px; font-weight: 600;">Temporary Pass:</span>
                        <span style="color: #0d9488; font-size: 14px; font-weight: 900; float: right; font-family: monospace;">{password}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin-bottom: 32px;">
                    <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">Please verify your account to activate your portal access:</p>
                    <a href="{request.url_root}verification-success" style="display: inline-block; background: linear-gradient(135deg, #0d9488, #0f766e); color: white; padding: 18px 40px; border-radius: 20px; text-decoration: none; font-weight: 800; font-size: 16px; box-shadow: 0 10px 20px rgba(13, 148, 136, 0.3); text-transform: uppercase; letter-spacing: 1px;">Verify Account & Login</a>
                </div>
                
                <p style="color: #94a3b8; font-size: 12px; text-align: center; line-height: 20px;">
                    This link will expire in 24 hours. For security reasons, please change your password immediately after your first login.
                </p>
            </div>
            
            <div style="text-align: center; margin-top: 32px;">
                <p style="color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px;">OrthoConnect Administration</p>
            </div>
        </div>
        """
        msg.body = f"Congratulations {name}! Welcome to OrthoConnect. Your credentials: Email: {email}, Password: {password}. Verify here: {request.url_root}verification-success"
        
        if MAIL_DEBUG_MODE:
            print("--- SIMULATED HIRING EMAIL ---")
            print(f"To: {email}")
            print(f"Credentials Sent: Email={email}, Pass={password}")
            print("------------------------------")
        else:
            mail.send(msg)
        
        # Return the password so the frontend can also use it to create the Supabase record
        return jsonify({"success": True, "password": password, "debug": MAIL_DEBUG_MODE})
    except Exception as e:
        print("------- HIRING EMAIL ERROR -------")
        traceback.print_exc()
        print("----------------------------------")
        return jsonify({"error": f"Hiring email failed: {str(e)}"}), 500


# Appointment reminder API removed as requested.

# ---------- MFA / Restricted Area Security ----------

@app.route("/api/auth/send-verification", methods=["POST"])
def send_mfa_verification():
    data = request.json
    email = data.get("email") or app.config['MAIL_USERNAME']
    
    # Generate a unique request ID
    req_id = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    
    try:
        # Create verification link
        verify_link = f"{request.url_root}verify/{req_id}"
        
        msg = Message("Action Required: Verify Your Identity - OrthoConnect",
                      recipients=[email])
        
        # Use HTML for a premium looking button
        msg.html = f"""
        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background-color: #f8fafc; border-radius: 24px;">
            <div style="background-color: white; padding: 40px; border-radius: 32px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="color: #1e293b; font-size: 24px; font-weight: 800; margin-bottom: 8px;">Security Verification</h1>
                    <p style="color: #64748b; font-size: 14px;">A restricted area access was requested.</p>
                </div>
                
                <p style="color: #475569; font-size: 16px; line-height: 24px; margin-bottom: 32px; text-align: center;">
                    Hello Administrator,<br><br>
                    To continue accessing <b>User Management</b> or <b>Operation Flow</b>, please verify your identity by clicking the button below:
                </p>
                
                <div style="text-align: center; margin-bottom: 32px;">
                    <a href="{verify_link}" style="display: inline-block; background-color: #2563eb; color: white; padding: 16px 32px; border-radius: 16px; text-decoration: none; font-weight: 700; font-size: 16px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">Verify Identity Now</a>
                </div>
                
                <p style="color: #94a3b8; font-size: 12px; text-align: center; line-height: 18px;">
                    If you did not initiate this request, please ignore this email or contact support.<br>
                    This link will expire for your security.
                </p>
            </div>
            
            <div style="text-align: center; margin-top: 24px;">
                <p style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">OrthoConnect Security Team</p>
            </div>
        </div>
        """
        msg.body = f"Hello Administrator,\n\nPlease verify your identity by clicking this link: {verify_link}"

        
        if MAIL_DEBUG_MODE:
            print(f"--- MFA VERIFICATION LINK FOR {email} ---")
            print(f"Link: {verify_link}")
            print("------------------------------------------")
        else:
            mail.send(msg)

        # Store in-memory
        verification_requests[req_id] = {
            "email": email,
            "verified": False,
            "created_at": datetime.now()
        }

        return jsonify({"success": True, "request_id": req_id})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/verify/<req_id>")
def handle_verify_link(req_id):
    if req_id in verification_requests:
        verification_requests[req_id]["verified"] = True
        return """
        <html>
            <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f8fafc;">
                <div style="text-align: center; padding: 40px; background: white; border-radius: 20px; shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
                    <h1 style="color: #10b981;">Identity Verified!</h1>
                    <p style="color: #64748b;">You can now return to the portal. This window can be closed.</p>
                </div>
            </body>
        </html>
        """
    return "Invalid or expired verification link.", 400

@app.route("/api/auth/check-verification-status", methods=["POST"])
def check_mfa_status():
    data = request.json
    req_id = data.get("request_id")
    
    if req_id in verification_requests:
        is_verified = verification_requests[req_id]["verified"]
        if is_verified:
            # Clean up after successful check to prevent re-use
            # del verification_requests[req_id] 
            return jsonify({"success": True, "verified": True})
        return jsonify({"success": True, "verified": False})
    
    return jsonify({"error": "Request ID not found"}), 404


@app.route("/api/patient/status-email", methods=["POST"])
def send_patient_status_email():
    data = request.json
    email = data.get("email")
    name = data.get("name")
    status = data.get("status") # "approved" or "declined"

    if not email or not name or not status:
        return jsonify({"error": "Missing info"}), 400

    try:
        subject = "Account Verified - OrthoConnect Clinic" if status == "approved" else "Account Creation Status - OrthoConnect Clinic"
        
        if status == "approved":
            body = f"""
Dear {name},

Great news! Your account at OrthoConnect Orthodontic Clinic has been verified.

Your account is now ready to login. You can now use the mobile app to book appointments and manage your dental records.

Welcome to our clinic!

Best regards,
OrthoConnect Administration
"""
        else:
            body = f"""
Dear {name},

Thank you for your interest in joining OrthoConnect Orthodontic Clinic.

After reviewing your application, we regret to inform you that your account creation has been declined by the administrator. This is typically because the information provided does not match our existing patient records.

If you believe this is an error, please visit our clinic or contact us directly.

Best regards,
OrthoConnect Administration
"""

        msg = Message(subject, recipients=[email])
        msg.body = body
        
        if MAIL_DEBUG_MODE:
            print(f"--- SIMULATED {status.upper()} EMAIL ---")
            print(f"To: {email}")
            print(body)
            print("-----------------------------------------")
        else:
            mail.send(msg)

        return jsonify({"success": True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ---------- Run ----------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)

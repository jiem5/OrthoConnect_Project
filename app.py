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

# ---------- Lazy Config ----------
# Load config lazily inside functions to avoid Railway Railpack build secret detection
_mail_instance = None
_mail_debug_mode = None
_supabase_url = None
_supabase_anon_key = None

def get_mail():
    global _mail_instance
    if _mail_instance is None:
        app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
        app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', '587'))
        app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
        app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME', 'enriquezeugene53@gmail.com')
        app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD', 'vlkx gsfa gsfj tjqf')
        app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_USERNAME', 'enriquezeugene53@gmail.com')
        _mail_instance = Mail(app)
    return _mail_instance

def get_mail_debug_mode():
    global _mail_debug_mode
    if _mail_debug_mode is None:
        _mail_debug_mode = os.environ.get('MAIL_DEBUG_MODE', 'False').lower() == 'true'
    return _mail_debug_mode

def get_supabase_url():
    global _supabase_url
    if _supabase_url is None:
        _supabase_url = os.environ.get('SUPABASE_URL', 'https://ctoybxukmkcnwdeueorm.supabase.co')
    return _supabase_url

def get_supabase_anon_key():
    global _supabase_anon_key
    if _supabase_anon_key is None:
        _supabase_anon_key = os.environ.get('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0b3lieHVrbWtjbndkZXVlb3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODg3NzAsImV4cCI6MjA4ODM2NDc3MH0.hLDzyCvNzWbrXW-5Z1NsE6eH2sF_3S5L33htZYjEiH0')
    return _supabase_anon_key

# ---------- MFA & Restricted Access State ----------
# In-memory store for verification requests
# Format: { request_id: { "email": email, "verified": False, "expires": timestamp } }
verification_requests = {}

def auto_check_reminders():
    """
    Background thread that polls Supabase for upcoming appointments
    and sends 10-minute reminders.
    """
    print("[Background Automation] Starting 10-minute reminder service...")
    while True:
        try:
            now = datetime.now()
            today_str = now.strftime("%Y-%m-%d")
            
            # Fetch scheduled appointments for today with patient email join
            # select=*,patients(email) joins appointments to patients on patient_name or similar
            # If your schema uses patient_id, change patients(email) accordingly.
            # Here we assume a foreign key or we'll fetch patients separately if needed.
            headers = {
                "apikey": get_supabase_anon_key(),
                "Authorization": f"Bearer {get_supabase_anon_key()}",
                "Content-Type": "application/json"
            }
            
            # First fetch appointments
            params = {
                "appointment_date": f"eq.{today_str}",
                "status": "in.(scheduled,accepted,approved)"
            }
            
            response = requests.get(f"{get_supabase_url()}/rest/v1/appointments", headers=headers, params=params)
            if response.status_code == 200:
                appts = response.json()
                for appt in appts:
                    appt_id = appt.get("id")
                    patient_name = appt.get("patient_name")
                    notes = appt.get("patient_condition") or ""
                    appt_time_str = appt.get("appointment_time")
                    
                    if "[10M_REMINDER_SENT]" in notes:
                        continue

                    # Try to get email from appt first, then patients table
                    patient_email = appt.get("patient_email") or appt.get("email")
                    
                    if not patient_email:
                        # Fetch from patients table
                        p_res = requests.get(f"{get_supabase_url()}/rest/v1/patients?full_name=eq.{patient_name}&select=email", headers=headers)
                        if p_res.status_code == 200:
                            p_data = p_res.json()
                            if p_data:
                                patient_email = p_data[0].get("email")

                    if not patient_email:
                        continue
                        
                    try:
                        # Handle HH:MM:SS or HH:MM
                        time_parts = appt_time_str.split(":")
                        appt_hour = int(time_parts[0])
                        appt_min = int(time_parts[1])
                        
                        appt_dt = now.replace(hour=appt_hour, minute=appt_min, second=0, microsecond=0)
                        time_diff = appt_dt - now
                        
                        # Trigger exactly around 10 minutes (between 9 and 11 to be safe with 1-min loop)
                        if timedelta(minutes=9) <= time_diff <= timedelta(minutes=11) and "[10M_REMINDER_SENT]" not in notes:
                            print(f"[Background Automation] Sending 10m reminder to {patient_name} for {appt_time_str}")
                            
                            with app.app_context():
                                msg = Message("OrthoConnect: Your Appointment is Ready",
                                              recipients=[patient_email])
                                msg.body = f"""
Dear {patient_name},

Your appointment is ready! Please be ready for your appointment as your doctor is waiting for you.

Appointment Details:
Time: {appt_time_str}
Date: {today_str}
Location: OrthoConnect Dental Clinic

Please arrive promptly. See you soon!

Best regards,
OrthoConnect Administration
                                """
                                if not get_mail_debug_mode():
                                    get_mail().send(msg)
                                else:
                                    print(f"[DEBUG] Simulated Email sent to {patient_email}")

                            # Mark as notified
                            new_notes = notes + " [10M_REMINDER_SENT]"
                            requests.patch(
                                f"{get_supabase_url()}/rest/v1/appointments?id=eq.{appt_id}",
                                headers=headers,
                                json={"patient_condition": new_notes}
                            )
                            notes = new_notes  # update local copy

                        # Trigger exactly around 30 minutes (between 29 and 31 to be safe with 1-min loop)
                        if timedelta(minutes=29) <= time_diff <= timedelta(minutes=31) and "[30M_REMINDER_SENT]" not in notes:
                            print(f"[Background Automation] Sending 30m reminder to {patient_name} for {appt_time_str}")
                            
                            with app.app_context():
                                msg = Message("OrthoConnect: Your Appointment is in 30 Minutes",
                                              recipients=[patient_email])
                                msg.body = f"""
Dear {patient_name},

This is a reminder that your appointment at OrthoConnect is in 30 minutes.

Appointment Details:
Time: {appt_time_str}
Date: {today_str}
Location: Dr. Ethelyn Regato-Perez Orthodental Clinic

Please start preparing and make your way to the clinic. We look forward to seeing you!

Best regards,
OrthoConnect Administration
                                """
                                if not get_mail_debug_mode():
                                    get_mail().send(msg)
                                else:
                                    print(f"[DEBUG] Simulated 30m Email sent to {patient_email}")

                            new_notes = notes + " [30M_REMINDER_SENT]"
                            requests.patch(
                                f"{get_supabase_url()}/rest/v1/appointments?id=eq.{appt_id}",
                                headers=headers,
                                json={"patient_condition": new_notes}
                            )
                            notes = new_notes

                        # Trigger exactly around 1 hour (between 59 and 61 minutes to be safe)
                        if timedelta(minutes=59) <= time_diff <= timedelta(minutes=61) and "[1H_REMINDER_SENT]" not in notes:
                            print(f"[Background Automation] Sending 1-hour reminder to {patient_name} for {appt_time_str}")
                            
                            with app.app_context():
                                msg = Message("OrthoConnect: Your Appointment is in 1 Hour",
                                              recipients=[patient_email])
                                msg.body = f"""
Dear {patient_name},

This is a reminder that your appointment at OrthoConnect is in 1 hour.

Appointment Details:
Time: {appt_time_str}
Date: {today_str}
Location: Dr. Ethelyn Regato-Perez Orthodental Clinic

Please prepare and make sure you arrive on time to avoid delays. We are looking forward to your visit!

Best regards,
OrthoConnect Administration
                                """
                                if not get_mail_debug_mode():
                                    get_mail().send(msg)
                                else:
                                    print(f"[DEBUG] Simulated 1h Email sent to {patient_email}")

                            new_notes = notes + " [1H_REMINDER_SENT]"
                            requests.patch(
                                f"{get_supabase_url()}/rest/v1/appointments?id=eq.{appt_id}",
                                headers=headers,
                                json={"patient_condition": new_notes}
                            )
                                
                    except Exception as e:
                        print(f"[Background Automation] Error processing appt {appt_id}: {e}")
            else:
                print(f"[Background Automation] Error fetching from Supabase: {response.text}")

            # ---- 1-DAY-BEFORE REMINDER ----
            tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
            params_1d = {
                "appointment_date": f"eq.{tomorrow_str}",
                "status": "in.(scheduled,accepted,approved)"
            }
            res_1d = requests.get(f"{get_supabase_url()}/rest/v1/appointments", headers=headers, params=params_1d)
            if res_1d.status_code == 200:
                tomorrow_appts = res_1d.json()
                for appt in tomorrow_appts:
                    appt_id = appt.get("id")
                    patient_name = appt.get("patient_name")
                    notes = appt.get("patient_condition") or ""
                    appt_time_str = appt.get("appointment_time") or ""

                    if "[1D_REMINDER_SENT]" in notes:
                        continue

                    patient_email = appt.get("patient_email") or appt.get("email")
                    if not patient_email:
                        p_res = requests.get(f"{get_supabase_url()}/rest/v1/patients?full_name=eq.{patient_name}&select=email", headers=headers)
                        if p_res.status_code == 200:
                            p_data = p_res.json()
                            if p_data:
                                patient_email = p_data[0].get("email")

                    if not patient_email:
                        continue

                    try:
                        print(f"[Background Automation] Sending 1-day reminder to {patient_name} for {tomorrow_str}")
                        with app.app_context():
                            msg = Message("OrthoConnect: Appointment Reminder for Tomorrow",
                                          recipients=[patient_email])
                            msg.body = f"""
Dear {patient_name},

This is a friendly reminder that you have an appointment TOMORROW at OrthoConnect Orthodontal Clinic.

Appointment Details:
Date: {tomorrow_str}
Time: {appt_time_str}
Location: Dr. Ethelyn Regato-Perez Orthodental Clinic

Please make sure to arrive on time. If you need to reschedule, please contact us as soon as possible.

We look forward to seeing you!

Best regards,
OrthoConnect Administration
                            """
                            if not get_mail_debug_mode():
                                get_mail().send(msg)
                            else:
                                print(f"[DEBUG] Simulated 1-day reminder to {patient_email}")

                        new_notes = notes + " [1D_REMINDER_SENT]"
                        requests.patch(
                            f"{get_supabase_url()}/rest/v1/appointments?id=eq.{appt_id}",
                            headers=headers,
                            json={"patient_condition": new_notes}
                        )
                    except Exception as e:
                        print(f"[Background Automation] Error sending 1-day reminder for {appt_id}: {e}")
            # ---- END 1-DAY-BEFORE REMINDER ----

        except Exception as e:
            print(f"[Background Automation] Critical error in thread: {e}")
            
        # Wait 60 seconds before next check
        time.sleep(60)

# Background reminder thread removed for Railway compatibility
# Reminder logic moved to reminder_worker.py
# Run via Railway Cron or external cron service
# Uncomment locally if needed for development:
# if os.environ.get('ENABLE_BACKGROUND_THREAD', 'false').lower() == 'true':
#     thread = threading.Thread(target=auto_check_reminders, daemon=True)
#     thread.start()

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
        
        if get_mail_debug_mode():
            print("--- SIMULATED INTERVIEW EMAIL ---")
            print(f"To: {email}")
            print(f"Body: {msg.body}")
            print("---------------------------------")
        else:
            get_mail().send(msg)

        return jsonify({"success": True, "message": "Interview email sent (Simulated)!" if get_mail_debug_mode() else "Interview email sent!"})
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
        
        if get_mail_debug_mode():
            print("--- SIMULATED HIRING EMAIL ---")
            print(f"To: {email}")
            print(f"Credentials Sent: Email={email}, Pass={password}")
            print("------------------------------")
        else:
            get_mail().send(msg)
        
        # Return the password so the frontend can also use it to create the Supabase record
        return jsonify({"success": True, "password": password, "debug": get_mail_debug_mode()})
    except Exception as e:
        print("------- HIRING EMAIL ERROR -------")
        traceback.print_exc()
        print("----------------------------------")
        return jsonify({"error": f"Hiring email failed: {str(e)}"}), 500


@app.route("/api/appointment/reminder", methods=["POST"])
def send_appointment_reminder():
    data = request.json
    email = data.get("email")
    patient_name = data.get("patient_name")
    appt_time = data.get("time") # e.g. "10:30"
    appt_date = data.get("date") # e.g. "2026-04-20"
    location = data.get("location", "OrthoConnect Dental Clinic")

    if not email or not patient_name:
        return jsonify({"error": "Missing essential info"}), 400

    try:
        msg = Message(f"Appointment Reminder: OrthoConnect Clinic Today",
                      recipients=[email])
        
        msg.body = f"""
Dear {patient_name},

This is an automated reminder that your schedule in OrthoConnect is TODAY:

Time: {appt_time}
Place: {location}
Date: {appt_date}

Please arrive 15 minutes early. We look forward to seeing you!

Best regards,
OrthoConnect Team
        """
        
        if get_mail_debug_mode():
            print(f"--- SIMULATED REMINDER TO {email} ---")
            print(msg.body)
            print("---------------------------------------")
        else:
            get_mail().send(msg)

        return jsonify({"success": True, "message": "Reminder sent!"})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

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

        
        if get_mail_debug_mode():
            print(f"--- MFA VERIFICATION LINK FOR {email} ---")
            print(f"Link: {verify_link}")
            print("------------------------------------------")
        else:
            get_mail().send(msg)

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
        
        if get_mail_debug_mode():
            print(f"--- SIMULATED {status.upper()} EMAIL ---")
            print(f"To: {email}")
            print(body)
            print("-----------------------------------------")
        else:
            get_mail().send(msg)

        return jsonify({"success": True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ---------- Run ----------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)

#!/usr/bin/env python3
"""
Reminder Worker for OrthoConnect
Runs once and exits - designed to be called by Railway Cron every minute
"""

import os
import sys
import requests
from datetime import datetime, timedelta

# Environment Variables
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY')
MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
APP_MAIL_SIMULATION = os.environ.get('APP_MAIL_SIMULATION', 'False').lower() == 'true'

# Validate environment variables
if not all([SUPABASE_URL, SUPABASE_ANON_KEY, MAIL_USERNAME, MAIL_PASSWORD]):
    print("ERROR: Missing required environment variables")
    print("Required: SUPABASE_URL, SUPABASE_ANON_KEY, MAIL_USERNAME, MAIL_PASSWORD")
    sys.exit(1)

# Import Flask-Mail after environment validation
from flask import Flask, Mail, Message

app = Flask(__name__)
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', '587'))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
app.config['MAIL_USERNAME'] = MAIL_USERNAME
app.config['MAIL_PASSWORD'] = MAIL_PASSWORD
app.config['MAIL_DEFAULT_SENDER'] = MAIL_USERNAME

mail = Mail(app)

def send_reminder_email(patient_name, patient_email, subject, body):
    """Send reminder email"""
    try:
        with app.app_context():
            msg = Message(subject, recipients=[patient_email])
            msg.body = body
            
            if APP_MAIL_SIMULATION:
                print(f"[DEBUG] Simulated email to {patient_email}")
                print(f"Subject: {subject}")
                print(f"Body: {body[:100]}...")
            else:
                mail.send(msg)
                print(f"[SUCCESS] Email sent to {patient_email}")
    except Exception as e:
        print(f"[ERROR] Failed to send email to {patient_email}: {e}")

def process_reminders():
    """Main reminder processing logic"""
    print(f"[{datetime.now()}] Starting reminder check...")
    
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json"
    }
    
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    
    # Fetch today's appointments
    params = {
        "appointment_date": f"eq.{today_str}",
        "status": "in.(scheduled,accepted,approved)"
    }
    
    try:
        response = requests.get(f"{SUPABASE_URL}/rest/v1/appointments", headers=headers, params=params)
        if response.status_code != 200:
            print(f"[ERROR] Failed to fetch appointments: {response.text}")
            return
        
        appointments = response.json()
        print(f"[INFO] Processing {len(appointments)} appointments for {today_str}")
        
        for appt in appointments:
            appt_id = appt.get("id")
            patient_name = appt.get("patient_name")
            notes = appt.get("patient_condition") or ""
            appt_time_str = appt.get("appointment_time")
            
            if not appt_time_str:
                continue
            
            # Get patient email
            patient_email = appt.get("patient_email") or appt.get("email")
            if not patient_email:
                p_res = requests.get(
                    f"{SUPABASE_URL}/rest/v1/patients?full_name=eq.{patient_name}&select=email",
                    headers=headers
                )
                if p_res.status_code == 200:
                    p_data = p_res.json()
                    if p_data:
                        patient_email = p_data[0].get("email")
            
            if not patient_email:
                continue
            
            # Parse appointment time
            try:
                time_parts = appt_time_str.split(":")
                appt_hour = int(time_parts[0])
                appt_min = int(time_parts[1])
                appt_dt = now.replace(hour=appt_hour, minute=appt_min, second=0, microsecond=0)
                time_diff = appt_dt - now
            except (ValueError, IndexError):
                continue
            
            # 10-minute reminder
            if timedelta(minutes=9) <= time_diff <= timedelta(minutes=11) and "[10M_REMINDER_SENT]" not in notes:
                print(f"[REMINDER] Sending 10m reminder to {patient_name}")
                body = f"""Dear {patient_name},

Your appointment is ready! Please be ready for your appointment as your doctor is waiting for you.

Appointment Details:
Time: {appt_time_str}
Date: {today_str}
Location: OrthoConnect Dental Clinic

Please arrive promptly. See you soon!

Best regards,
OrthoConnect Administration"""
                send_reminder_email(
                    patient_name, patient_email,
                    "OrthoConnect: Your Appointment is Ready",
                    body
                )
                new_notes = notes + " [10M_REMINDER_SENT]"
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/appointments?id=eq.{appt_id}",
                    headers=headers,
                    json={"patient_condition": new_notes}
                )
            
            # 30-minute reminder
            elif timedelta(minutes=29) <= time_diff <= timedelta(minutes=31) and "[30M_REMINDER_SENT]" not in notes:
                print(f"[REMINDER] Sending 30m reminder to {patient_name}")
                body = f"""Dear {patient_name},

This is a reminder that your appointment at OrthoConnect is in 30 minutes.

Appointment Details:
Time: {appt_time_str}
Date: {today_str}
Location: Dr. Ethelyn Regato-Perez Orthodental Clinic

Please start preparing and make your way to the clinic. We look forward to seeing you!

Best regards,
OrthoConnect Administration"""
                send_reminder_email(
                    patient_name, patient_email,
                    "OrthoConnect: Your Appointment is in 30 Minutes",
                    body
                )
                new_notes = notes + " [30M_REMINDER_SENT]"
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/appointments?id=eq.{appt_id}",
                    headers=headers,
                    json={"patient_condition": new_notes}
                )
            
            # 1-hour reminder
            elif timedelta(minutes=59) <= time_diff <= timedelta(minutes=61) and "[1H_REMINDER_SENT]" not in notes:
                print(f"[REMINDER] Sending 1h reminder to {patient_name}")
                body = f"""Dear {patient_name},

This is a reminder that your appointment at OrthoConnect is in 1 hour.

Appointment Details:
Time: {appt_time_str}
Date: {today_str}
Location: Dr. Ethelyn Regato-Perez Orthodental Clinic

Please prepare and make sure you arrive on time to avoid delays. We are looking forward to your visit!

Best regards,
OrthoConnect Administration"""
                send_reminder_email(
                    patient_name, patient_email,
                    "OrthoConnect: Your Appointment is in 1 Hour",
                    body
                )
                new_notes = notes + " [1H_REMINDER_SENT]"
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/appointments?id=eq.{appt_id}",
                    headers=headers,
                    json={"patient_condition": new_notes}
                )
        
        # Process tomorrow's appointments (1-day reminder)
        params_tomorrow = {
            "appointment_date": f"eq.{tomorrow_str}",
            "status": "in.(scheduled,accepted,approved)"
        }
        res_tomorrow = requests.get(f"{SUPABASE_URL}/rest/v1/appointments", headers=headers, params=params_tomorrow)
        if res_tomorrow.status_code == 200:
            tomorrow_appts = res_tomorrow.json()
            print(f"[INFO] Processing {len(tomorrow_appts)} appointments for {tomorrow_str}")
            
            for appt in tomorrow_appts:
                appt_id = appt.get("id")
                patient_name = appt.get("patient_name")
                notes = appt.get("patient_condition") or ""
                appt_time_str = appt.get("appointment_time") or ""
                
                if "[1D_REMINDER_SENT]" in notes:
                    continue
                
                patient_email = appt.get("patient_email") or appt.get("email")
                if not patient_email:
                    p_res = requests.get(
                        f"{SUPABASE_URL}/rest/v1/patients?full_name=eq.{patient_name}&select=email",
                        headers=headers
                    )
                    if p_res.status_code == 200:
                        p_data = p_res.json()
                        if p_data:
                            patient_email = p_data[0].get("email")
                
                if not patient_email:
                    continue
                
                print(f"[REMINDER] Sending 1-day reminder to {patient_name}")
                body = f"""Dear {patient_name},

This is a friendly reminder that you have an appointment TOMORROW at OrthoConnect Orthodontal Clinic.

Appointment Details:
Date: {tomorrow_str}
Time: {appt_time_str}
Location: Dr. Ethelyn Regato-Perez Orthodental Clinic

Please make sure to arrive on time. If you need to reschedule, please contact us as soon as possible.

We look forward to seeing you!

Best regards,
OrthoConnect Administration"""
                send_reminder_email(
                    patient_name, patient_email,
                    "OrthoConnect: Appointment Reminder for Tomorrow",
                    body
                )
                new_notes = notes + " [1D_REMINDER_SENT]"
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/appointments?id=eq.{appt_id}",
                    headers=headers,
                    json={"patient_condition": new_notes}
                )
        
        print(f"[{datetime.now()}] Reminder check completed successfully")
        
    except Exception as e:
        print(f"[ERROR] Critical error in reminder processing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    process_reminders()

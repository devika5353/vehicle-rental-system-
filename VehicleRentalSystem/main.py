import os
import re
import mysql.connector
import jwt
from datetime import datetime, timedelta, date
from decimal import Decimal, ROUND_HALF_UP
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

load_dotenv()

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="Vehicle Rental Management System API",
    version="1.0.0"
)

print("=== RUNNING FILE:", __file__)

# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# AUTH CONFIG (JWT)
# ============================================================

SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "dev-only-change-this-secret-key"
)

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8


def create_access_token(customer_id: int, email: str, role: str) -> str:
    payload = {
        "customer_id": customer_id,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def get_current_user(authorization: str = Header(default=None)):
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header"
        )

    token = authorization.replace("Bearer ", "", 1)

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token expired, please log in again"
        )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )


def require_admin(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )

    return user


def require_customer(user: dict = Depends(get_current_user)):
    if user.get("role") != "customer":
        raise HTTPException(
            status_code=403,
            detail="Customer access required"
        )

    return user


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_db_connection():
    try:

        connection = mysql.connector.connect(
            host=os.getenv("DB_HOST"),
            port=int(os.getenv("DB_PORT", 3306)),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            database=os.getenv("DB_NAME")
        )

        return connection

    except mysql.connector.Error as e:

        raise HTTPException(
            status_code=500,
            detail=f"Database connection failed: {str(e)}"
        )


# ============================================================
# PYDANTIC MODELS
# ============================================================

class Customer(BaseModel):
    name: str
    phone: str
    email: str


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: str
    phone: str
    password: str


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_PATTERN = re.compile(r"^\+?\d{7,14}$")
MIN_PASSWORD_LENGTH = 6


class Vehicle(BaseModel):
    vehicle_name: str
    type: str
    rate_per_day: float


class RentalCreate(BaseModel):
    customer_id: int
    vehicle_id: int
    start_date: str
    end_date: str


class RentalUpdate(BaseModel):
    customer_id: int
    vehicle_id: int
    start_date: str
    end_date: str
    actual_return_date: str | None = None


class Payment(BaseModel):
    rental_id: int
    total_amount: float
    late_fee: float = 0


class PaymentTransaction(BaseModel):
    payment_id: int
    amount: float
    payment_mode: str


class CustomerBookingCreate(BaseModel):
    vehicle_id: int
    start_date: str
    end_date: str
    pickup_time: str
    dropoff_time: str
    pickup_location: str
    dropoff_location: str
    pillion_addon: bool = False


class VehicleSearchRequest(BaseModel):
    start_date: str
    end_date: str
    pickup_time: str
    dropoff_time: str
    pickup_location: str
    dropoff_location: str


class CustomerPaymentRequest(BaseModel):
    payment_mode: str


PILLION_ADDON_AMOUNT = 100.00

BUSINESS_OPEN = "08:00"
BUSINESS_CLOSE = "20:00"
TIME_SLOT_MINUTES = 30

# ============================================================
# BOOKING LOCATIONS (Kochi)
#
# Single source of truth. The frontend loads this list from
# GET /customer/booking-config. To add a location, add one
# entry here. latitude/longitude are reserved for a future map.
# ============================================================

OTHER_LOCATION_NAME = "Other Location"

BOOKING_LOCATIONS = [
    {"id": "other",        "name": "Other Location",                           "latitude": None, "longitude": None},
    {"id": "kalamassery",  "name": "Kalamassery : EVM Wheels Pillar 292",      "latitude": None, "longitude": None},
    {"id": "vyttila",      "name": "Vyttila : Metro Station Mobility Hub",     "latitude": None, "longitude": None},
    {"id": "south-rly",    "name": "South : Near Railway Station",             "latitude": None, "longitude": None},
    {"id": "north-rly",    "name": "North : Near Railway Station",             "latitude": None, "longitude": None},
    {"id": "aluva",        "name": "Aluva : Near Railway Station",             "latitude": None, "longitude": None},
    {"id": "marriott",     "name": "Marriott Hotel : Kochi",                   "latitude": None, "longitude": None},
    {"id": "le-meridien",  "name": "Le Méridien : Kochi",                      "latitude": None, "longitude": None},
    {"id": "four-points",  "name": "Four Points by Sheraton : Kochi Infopark", "latitude": None, "longitude": None},
    {"id": "grand-hyatt",  "name": "Grand Hyatt Kochi : Bolgatty",             "latitude": None, "longitude": None},
    {"id": "thykoodam",    "name": "Thykoodam : EV Green Hub",                 "latitude": None, "longitude": None},
]

LOCATION_NAMES = {loc["name"] for loc in BOOKING_LOCATIONS}


def validate_location(value: str, label: str) -> str:
    """Accepts a predefined name, or 'Other Location: <free text>'."""
    text = (value or "").strip()

    if text in LOCATION_NAMES:
        return text

    prefix = OTHER_LOCATION_NAME + ":"

    if (
            text.startswith(prefix)
            and text[len(prefix):].strip()
            and len(text) <= 150
    ):
        return text

    raise HTTPException(
        status_code=400,
        detail=f"Please choose a valid {label}"
    )


def build_time_slots() -> list[str]:
    def to_minutes(value: str) -> int:
        hours, minutes = value.split(":")
        return int(hours) * 60 + int(minutes)

    return [
        f"{m // 60:02d}:{m % 60:02d}"
        for m in range(
            to_minutes(BUSINESS_OPEN),
            to_minutes(BUSINESS_CLOSE) + 1,
            TIME_SLOT_MINUTES
        )
    ]


VALID_TIME_SLOTS = build_time_slots()


def normalize_time(value: str, label: str) -> str:
    text = (value or "").strip()

    if len(text) == 8 and text.endswith(":00"):
        text = text[:5]

    if text not in VALID_TIME_SLOTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{label} must be on the half hour between "
                f"{BUSINESS_OPEN} and {BUSINESS_CLOSE}"
            )
        )

    return text


def validate_booking_schedule(booking) -> tuple[str, str]:
    try:
        start = datetime.strptime(
            booking.start_date,
            "%Y-%m-%d"
        ).date()

        end = datetime.strptime(
            booking.end_date,
            "%Y-%m-%d"
        ).date()

    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Dates must be valid and use the YYYY-MM-DD format"
        )

    if start < date.today():
        raise HTTPException(
            status_code=400,
            detail="Pickup date cannot be in the past"
        )

    if end < start:
        raise HTTPException(
            status_code=400,
            detail="End date cannot be before start date"
        )

    pickup = normalize_time(
        booking.pickup_time,
        "Pickup time"
    )

    dropoff = normalize_time(
        booking.dropoff_time,
        "Drop-off time"
    )

    if start == end and dropoff <= pickup:
        raise HTTPException(
            status_code=400,
            detail="Drop-off time must be later than pickup time on the same day"
        )

    return pickup, dropoff


def calculate_rental_charge(
        start_date: str,
        pickup_time: str,
        end_date: str,
        dropoff_time: str,
        rate_per_day
) -> tuple[float, float]:
    """
    Hour-based pricing from the BOOKED pickup/drop-off datetimes.

        duration_hours = dropoff_datetime - pickup_datetime
        hourly_rate    = rate_per_day / 24
        rental_amount  = duration_hours * hourly_rate

    Returns (duration_hours, rental_amount). The actual return time
    (actual_return_date) is never used here.
    """

    try:
        pickup_dt = datetime.strptime(
            f"{start_date} {pickup_time}",
            "%Y-%m-%d %H:%M"
        )

        dropoff_dt = datetime.strptime(
            f"{end_date} {dropoff_time}",
            "%Y-%m-%d %H:%M"
        )

    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid pickup or drop-off date/time"
        )

    minutes = int((dropoff_dt - pickup_dt).total_seconds() // 60)

    if minutes <= 0:
        raise HTTPException(
            status_code=400,
            detail="Drop-off must be later than pickup"
        )

    duration_hours = Decimal(minutes) / Decimal(60)
    hourly_rate = Decimal(str(rate_per_day)) / Decimal(24)

    rental_amount = (duration_hours * hourly_rate).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP
    )

    return float(duration_hours), float(rental_amount)


# ============================================================
# SHARED AVAILABILITY RULE
#
# Used by BOTH the vehicle search and booking creation so the
# two can never disagree.
#
# A rental blocks a vehicle only while it has NOT been
# physically returned (actual_return_date IS NULL) AND either:
#   - it overlaps the requested period, or
#   - its scheduled drop-off has already passed (overdue; the
#     vehicle is still out until an admin records the return).
#
# A passed drop-off time NEVER frees a vehicle by itself.
#
# Params, in order: (requested_end_datetime, requested_start_datetime)
# ============================================================

BLOCKING_RENTAL_CONDITION = """
    r.actual_return_date IS NULL
    AND (
        (
            TIMESTAMP(r.start_date, COALESCE(r.pickup_time, '00:00:00')) < %s
            AND TIMESTAMP(r.end_date, COALESCE(r.dropoff_time, '23:59:59')) > %s
        )
        OR TIMESTAMP(r.end_date, COALESCE(r.dropoff_time, '23:59:59')) < NOW()
    )
"""


def to_datetime_str(date_text: str, time_text: str) -> str:
    return f"{date_text} {time_text}:00"


# ============================================================
# ROOT / FRONTEND
# ============================================================

frontend_path = os.path.join(
    os.path.dirname(__file__),
    "frontend"
)


@app.get("/")
def serve_frontend():
    index_file = os.path.join(
        frontend_path,
        "index.html"
    )

    if os.path.exists(index_file):
        return FileResponse(index_file)

    return {
        "message": "Vehicle Rental Management System API is running"
    }


@app.get("/api-status")
def api_status():
    return {
        "message": "Vehicle Rental Management System API is running"
    }


# ============================================================
# TEST DATABASE
# ============================================================

@app.get("/test-db")
def test_db():
    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute("SELECT DATABASE()")
    result = cursor.fetchone()

    cursor.close()
    connection.close()

    return {
        "message": "Database connected successfully",
        "database": result[0]
    }


# ============================================================
# LOGIN
# ============================================================

@app.post("/login")
def login(credentials: LoginRequest):
    connection = get_db_connection()

    cursor = connection.cursor(
        dictionary=True,
        buffered=True
    )

    cursor.execute(
        """
        SELECT customer_id, name, email, role
        FROM Customer
        WHERE email = %s
        AND password = %s
        """,
        (
            credentials.email,
            credentials.password
        )
    )

    user = cursor.fetchone()

    cursor.close()
    connection.close()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    token = create_access_token(
        customer_id=user["customer_id"],
        email=user["email"],
        role=user["role"]
    )

    return {
        "customer_id": user["customer_id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "access_token": token,
        "token_type": "bearer"
    }


# ============================================================
# CUSTOMER REGISTRATION
# ============================================================

@app.post("/register", status_code=201)
def register_customer(data: RegisterRequest):
    name = data.name.strip()
    email = data.email.strip().lower()
    phone = re.sub(r"[\s\-]", "", data.phone)
    password = data.password

    if not name or len(name) > 100:
        raise HTTPException(
            status_code=400,
            detail="Please enter your name (up to 100 characters)"
        )

    if len(email) > 100 or not EMAIL_PATTERN.match(email):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid email address"
        )

    if not PHONE_PATTERN.match(phone):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid phone number (7 to 14 digits)"
        )

    if len(password) < MIN_PASSWORD_LENGTH or len(password) > 255:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    connection = get_db_connection()
    cursor = connection.cursor(buffered=True)

    try:

        cursor.execute(
            "SELECT customer_id FROM Customer WHERE email = %s",
            (email,)
        )

        if cursor.fetchone():
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists"
            )

        cursor.execute(
            """
            INSERT INTO Customer
            (name, phone, email, password, role)
            VALUES (%s, %s, %s, %s, 'customer')
            """,
            (
                name,
                phone,
                email,
                password
            )
        )

        connection.commit()

        return {
            "message": "Account created successfully",
            "customer_id": cursor.lastrowid
        }

    except mysql.connector.Error as e:

        connection.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not create account: {str(e)}"
        )

    finally:

        cursor.close()
        connection.close()


# ============================================================
# CUSTOMER MANAGEMENT (ADMIN-ONLY)
# ============================================================

@app.get("/customers")
def get_customers(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Customer"
    )

    customers = cursor.fetchall()

    cursor.close()
    connection.close()

    return customers


@app.get("/customers/{customer_id}")
def get_customer(
        customer_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT *
        FROM Customer
        WHERE customer_id = %s
        """,
        (customer_id,)
    )

    customer = cursor.fetchone()

    cursor.close()
    connection.close()

    if not customer:
        raise HTTPException(
            status_code=404,
            detail="Customer not found"
        )

    return customer


@app.post("/customers")
def add_customer(
        customer: Customer,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        INSERT INTO Customer
        (name, phone, email)
        VALUES (%s, %s, %s)
    """

    cursor.execute(
        query,
        (
            customer.name,
            customer.phone,
            customer.email
        )
    )

    connection.commit()

    customer_id = cursor.lastrowid

    cursor.close()
    connection.close()

    return {
        "message": "Customer added successfully",
        "customer_id": customer_id
    }


@app.put("/customers/{customer_id}")
def update_customer(
        customer_id: int,
        customer: Customer,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        UPDATE Customer
        SET name = %s,
            phone = %s,
            email = %s
        WHERE customer_id = %s
    """

    cursor.execute(
        query,
        (
            customer.name,
            customer.phone,
            customer.email,
            customer_id
        )
    )

    connection.commit()

    if cursor.rowcount == 0:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Customer not found"
        )

    cursor.close()
    connection.close()

    return {
        "message": "Customer updated successfully"
    }


@app.delete("/customers/{customer_id}")
def delete_customer(
        customer_id: int,
        user: dict = Depends(require_admin)
):
    if customer_id == user["customer_id"]:
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own account"
        )

    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        DELETE FROM Customer
        WHERE customer_id = %s
        """,
        (customer_id,)
    )

    connection.commit()

    if cursor.rowcount == 0:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Customer not found"
        )

    cursor.close()
    connection.close()

    return {
        "message": "Customer deleted successfully"
    }


# ============================================================
# VEHICLE MANAGEMENT
# ============================================================

@app.get("/vehicles")
def get_vehicles(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Vehicle"
    )

    vehicles = cursor.fetchall()

    cursor.close()
    connection.close()

    return vehicles


@app.get("/vehicles/{vehicle_id}")
def get_vehicle(
        vehicle_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT *
        FROM Vehicle
        WHERE vehicle_id = %s
        """,
        (vehicle_id,)
    )

    vehicle = cursor.fetchone()

    cursor.close()
    connection.close()

    if not vehicle:
        raise HTTPException(
            status_code=404,
            detail="Vehicle not found"
        )

    return vehicle


@app.post("/vehicles")
def add_vehicle(
        vehicle: Vehicle,
        user: dict = Depends(require_admin)
):
    if vehicle.rate_per_day < 0:
        raise HTTPException(
            status_code=400,
            detail="Rate per day cannot be negative"
        )

    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        INSERT INTO Vehicle
        (vehicle_name, type, rate_per_day)
        VALUES (%s, %s, %s)
    """

    cursor.execute(
        query,
        (
            vehicle.vehicle_name,
            vehicle.type,
            vehicle.rate_per_day
        )
    )

    connection.commit()

    vehicle_id = cursor.lastrowid

    cursor.close()
    connection.close()

    return {
        "message": "Vehicle added successfully",
        "vehicle_id": vehicle_id
    }


@app.put("/vehicles/{vehicle_id}")
def update_vehicle(
        vehicle_id: int,
        vehicle: Vehicle,
        user: dict = Depends(require_admin)
):
    if vehicle.rate_per_day < 0:
        raise HTTPException(
            status_code=400,
            detail="Rate per day cannot be negative"
        )

    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        UPDATE Vehicle
        SET vehicle_name = %s,
            type = %s,
            rate_per_day = %s
        WHERE vehicle_id = %s
    """

    cursor.execute(
        query,
        (
            vehicle.vehicle_name,
            vehicle.type,
            vehicle.rate_per_day,
            vehicle_id
        )
    )

    connection.commit()

    if cursor.rowcount == 0:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Vehicle not found"
        )

    cursor.close()
    connection.close()

    return {
        "message": "Vehicle updated successfully"
    }


@app.delete("/vehicles/{vehicle_id}")
def delete_vehicle(
        vehicle_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        DELETE FROM Vehicle
        WHERE vehicle_id = %s
        """,
        (vehicle_id,)
    )

    connection.commit()

    if cursor.rowcount == 0:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Vehicle not found"
        )

    cursor.close()
    connection.close()

    return {
        "message": "Vehicle deleted successfully"
    }

# ============================================================
# FLEET SUMMARY (admin) - counts by vehicle type
#
# A vehicle is "out on rental" while any of its rentals has
# actual_return_date IS NULL, even if the scheduled end date
# has passed. Only the admin return action frees it.
# ============================================================

@app.get("/fleet/summary")
def get_fleet_summary(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            COALESCE(NULLIF(TRIM(v.type), ''), 'Other') AS type,
            COUNT(*) AS total,
            CAST(SUM(
                CASE WHEN o.vehicle_id IS NULL THEN 1 ELSE 0 END
            ) AS SIGNED) AS available
        FROM Vehicle v
        LEFT JOIN (
            SELECT DISTINCT vehicle_id
            FROM Rental
            WHERE actual_return_date IS NULL
        ) o ON o.vehicle_id = v.vehicle_id
        GROUP BY COALESCE(NULLIF(TRIM(v.type), ''), 'Other')
        ORDER BY 1
        """
    )

    rows = cursor.fetchall()

    cursor.close()
    connection.close()

    return [
        {
            "type": row["type"],
            "total": int(row["total"]),
            "available": int(row["available"]),
            "out_on_rental": int(row["total"]) - int(row["available"])
        }
        for row in rows
    ]
# ============================================================
# RENTAL MANAGEMENT
# ============================================================

@app.get("/rentals")
def get_rentals(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    # r.* already includes pickup_location and dropoff_location.
    # duration_hours is derived from the booked pickup/drop-off
    # datetimes (NULL for admin-created rentals without times).
    cursor.execute(
        """
        SELECT
            r.*,
            ROUND(TIMESTAMPDIFF(
                MINUTE,
                TIMESTAMP(r.start_date, r.pickup_time),
                TIMESTAMP(r.end_date, r.dropoff_time)
            ) / 60, 2) AS duration_hours
        FROM Rental r
        """
    )

    rentals = cursor.fetchall()

    cursor.close()
    connection.close()

    return rentals


@app.get("/rentals/summary")
def get_rentals_summary(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            r.rental_id,
            c.name AS customer_name,
            v.vehicle_name,
            r.start_date,
            r.end_date,
            r.actual_return_date,
            CASE
                WHEN r.actual_return_date IS NOT NULL
                    THEN 'Completed'
                WHEN r.end_date < CURDATE()
                    THEN 'Overdue'
                ELSE 'Ongoing'
            END AS status
        FROM Rental r
        JOIN Customer c
            ON r.customer_id = c.customer_id
        JOIN Vehicle v
            ON r.vehicle_id = v.vehicle_id
        ORDER BY r.rental_id DESC
        LIMIT 10
        """
    )

    rentals = cursor.fetchall()

    cursor.close()
    connection.close()

    return rentals


@app.get("/rentals/{rental_id}")
def get_rental(
        rental_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT *
        FROM Rental
        WHERE rental_id = %s
        """,
        (rental_id,)
    )

    rental = cursor.fetchone()

    cursor.close()
    connection.close()

    if not rental:
        raise HTTPException(
            status_code=404,
            detail="Rental not found"
        )

    return rental


@app.post("/rentals")
def add_rental(
        rental: RentalCreate,
        user: dict = Depends(require_admin)
):
    if rental.start_date > rental.end_date:
        raise HTTPException(
            status_code=400,
            detail="Start date cannot be after end date"
        )

    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        INSERT INTO Rental
        (
            customer_id,
            vehicle_id,
            start_date,
            end_date,
            approval_status
        )
        VALUES (%s, %s, %s, %s, %s)
    """

    cursor.execute(
        query,
        (
            rental.customer_id,
            rental.vehicle_id,
            rental.start_date,
            rental.end_date,
            "approved"
        )
    )

    connection.commit()

    rental_id = cursor.lastrowid

    cursor.close()
    connection.close()

    return {
        "message": "Rental added successfully",
        "rental_id": rental_id
    }


@app.put("/rentals/{rental_id}")
def update_rental(
        rental_id: int,
        rental: RentalUpdate,
        user: dict = Depends(require_admin)
):
    if rental.start_date > rental.end_date:
        raise HTTPException(
            status_code=400,
            detail="Start date cannot be after end date"
        )

    if (
            rental.actual_return_date is not None
            and rental.actual_return_date < rental.start_date
    ):
        raise HTTPException(
            status_code=400,
            detail="Actual return date cannot be before start date"
        )

    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        UPDATE Rental
        SET customer_id = %s,
            vehicle_id = %s,
            start_date = %s,
            end_date = %s,
            actual_return_date = %s,
            approval_status = 'approved'
        WHERE rental_id = %s
        """,
        (
            rental.customer_id,
            rental.vehicle_id,
            rental.start_date,
            rental.end_date,
            rental.actual_return_date,
            rental_id
        )
    )

    connection.commit()

    if cursor.rowcount == 0:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Rental not found"
        )

    cursor.close()
    connection.close()

    return {
        "message": "Rental updated successfully"
    }


# ============================================================
# ACTUAL VEHICLE RETURN / RESTOCKING
#
# The scheduled end_date/dropoff_time does NOT return the
# vehicle automatically.
#
# The vehicle becomes available only when an admin records
# the actual physical return.
# ============================================================

@app.post("/rentals/{rental_id}/return")
def return_rental(
        rental_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()

    try:

        connection.start_transaction()

        cursor = connection.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT
                r.rental_id,
                r.vehicle_id,
                r.rental_status,
                r.actual_return_date,
                v.vehicle_name
            FROM Rental r
            JOIN Vehicle v
                ON r.vehicle_id = v.vehicle_id
            WHERE r.rental_id = %s
            FOR UPDATE
            """,
            (rental_id,)
        )

        rental = cursor.fetchone()

        if not rental:
            raise HTTPException(
                status_code=404,
                detail="Rental not found"
            )

        if rental["actual_return_date"] is not None:
            raise HTTPException(
                status_code=409,
                detail="This vehicle has already been returned"
            )

        current_status = str(
            rental.get("rental_status") or ""
        ).lower()

        if current_status == "cancelled":
            raise HTTPException(
                status_code=409,
                detail="A cancelled rental cannot be returned"
            )

        cursor.execute(
            """
            UPDATE Rental
            SET actual_return_date = NOW(),
                rental_status = 'Completed'
            WHERE rental_id = %s
            AND actual_return_date IS NULL
            """,
            (rental_id,)
        )

        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=409,
                detail="This rental has already been returned"
            )

        cursor.execute(
            """
            UPDATE Vehicle
            SET is_available = 1
            WHERE vehicle_id = %s
            """,
            (rental["vehicle_id"],)
        )

        connection.commit()

        return_cursor = connection.cursor(dictionary=True)

        return_cursor.execute(
            """
            SELECT
                r.rental_id,
                r.vehicle_id,
                r.actual_return_date,
                r.rental_status,
                v.vehicle_name,
                v.is_available
            FROM Rental r
            JOIN Vehicle v
                ON r.vehicle_id = v.vehicle_id
            WHERE r.rental_id = %s
            """,
            (rental_id,)
        )

        result = return_cursor.fetchone()

        return_cursor.close()
        cursor.close()

        return {
            "message": "Vehicle returned successfully and restocked",
            "rental_id": result["rental_id"],
            "vehicle_id": result["vehicle_id"],
            "vehicle_name": result["vehicle_name"],
            "actual_return_date": result["actual_return_date"],
            "rental_status": result["rental_status"],
            "is_available": result["is_available"]
        }

    except HTTPException:

        connection.rollback()
        raise

    except mysql.connector.Error as e:

        connection.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not process vehicle return: {str(e)}"
        )

    finally:

        connection.close()


@app.delete("/rentals/{rental_id}")
def delete_rental(
        rental_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor()

    try:

        cursor.execute(
            """
            DELETE FROM Rental
            WHERE rental_id = %s
            """,
            (rental_id,)
        )

        connection.commit()

        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Rental not found"
            )

        return {
            "message": "Rental deleted successfully"
        }

    except mysql.connector.Error as e:

        connection.rollback()

        raise HTTPException(
            status_code=400,
            detail=f"Could not delete rental: {str(e)}"
        )

    finally:

        cursor.close()
        connection.close()


# ============================================================
# PAYMENT MANAGEMENT
# ============================================================

@app.get("/payments")
def get_payments(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Payment"
    )

    payments = cursor.fetchall()

    cursor.close()
    connection.close()

    return payments


@app.get("/payments/summary")
def get_payments_summary(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            p.payment_id,
            p.rental_id,
            p.total_amount,
            p.amount_paid,
            p.payment_status AS status,
            (
                SELECT pt.payment_mode
                FROM PaymentTransaction pt
                WHERE pt.payment_id = p.payment_id
                ORDER BY pt.transaction_id DESC
                LIMIT 1
            ) AS method
        FROM Payment p
        ORDER BY p.payment_id DESC
        LIMIT 10
        """
    )

    payments = cursor.fetchall()

    cursor.close()
    connection.close()

    return payments


@app.get("/payments/{payment_id}")
def get_payment(
        payment_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT *
        FROM Payment
        WHERE payment_id = %s
        """,
        (payment_id,)
    )

    payment = cursor.fetchone()

    cursor.close()
    connection.close()

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    return payment


@app.post("/payments")
def add_payment(
        payment: Payment,
        user: dict = Depends(require_admin)
):
    if payment.total_amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Total amount must be greater than 0"
        )

    if payment.late_fee < 0:
        raise HTTPException(
            status_code=400,
            detail="Late fee cannot be negative"
        )

    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        INSERT INTO Payment
        (
            rental_id,
            total_amount,
            late_fee
        )
        VALUES (%s, %s, %s)
    """

    cursor.execute(
        query,
        (
            payment.rental_id,
            payment.total_amount,
            payment.late_fee
        )
    )

    connection.commit()

    payment_id = cursor.lastrowid

    cursor.close()
    connection.close()

    return {
        "message": "Payment created successfully",
        "payment_id": payment_id
    }


@app.put("/payments/{payment_id}")
def update_payment(
        payment_id: int,
        payment: Payment,
        user: dict = Depends(require_admin)
):
    if payment.total_amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Total amount must be greater than 0"
        )

    if payment.late_fee < 0:
        raise HTTPException(
            status_code=400,
            detail="Late fee cannot be negative"
        )

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT amount_paid
        FROM Payment
        WHERE payment_id = %s
        """,
        (payment_id,)
    )

    existing_payment = cursor.fetchone()

    if not existing_payment:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    if payment.total_amount < existing_payment["amount_paid"]:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=400,
            detail="Total amount cannot be less than amount already paid"
        )

    cursor.execute(
        """
        UPDATE Payment
        SET rental_id = %s,
            total_amount = %s,
            late_fee = %s
        WHERE payment_id = %s
        """,
        (
            payment.rental_id,
            payment.total_amount,
            payment.late_fee,
            payment_id
        )
    )

    connection.commit()

    cursor.close()
    connection.close()

    return {
        "message": "Payment updated successfully"
    }


@app.delete("/payments/{payment_id}")
def delete_payment(
        payment_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor()

    try:

        cursor.execute(
            """
            DELETE FROM PaymentTransaction
            WHERE payment_id = %s
            """,
            (payment_id,)
        )

        cursor.execute(
            """
            DELETE FROM Payment
            WHERE payment_id = %s
            """,
            (payment_id,)
        )

        connection.commit()

        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Payment not found"
            )

        return {
            "message": "Payment and its transactions deleted successfully"
        }

    except mysql.connector.Error as e:

        connection.rollback()

        raise HTTPException(
            status_code=400,
            detail=f"Could not delete payment: {str(e)}"
        )

    finally:

        cursor.close()
        connection.close()


# ============================================================
# PAYMENT TRANSACTIONS
# ============================================================

@app.get("/transactions")
def get_transactions(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM PaymentTransaction"
    )

    transactions = cursor.fetchall()

    cursor.close()
    connection.close()

    return transactions


@app.get("/transactions/{transaction_id}")
def get_transaction(
        transaction_id: int,
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT *
        FROM PaymentTransaction
        WHERE transaction_id = %s
        """,
        (transaction_id,)
    )

    transaction = cursor.fetchone()

    cursor.close()
    connection.close()

    if not transaction:
        raise HTTPException(
            status_code=404,
            detail="Transaction not found"
        )

    return transaction


@app.post("/transactions")
def add_transaction(
        transaction: PaymentTransaction,
        user: dict = Depends(require_admin)
):
    allowed_modes = [
        "Cash",
        "Card",
        "UPI"
    ]

    if transaction.payment_mode not in allowed_modes:
        raise HTTPException(
            status_code=400,
            detail="Payment mode must be Cash, Card, or UPI"
        )

    if transaction.amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Transaction amount must be greater than 0"
        )

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            p.payment_id,
            p.total_amount,
            p.amount_paid
        FROM Payment p
        WHERE p.payment_id = %s
        """,
        (transaction.payment_id,)
    )

    payment = cursor.fetchone()

    if not payment:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    remaining_balance = (
            float(payment["total_amount"])
            - float(payment["amount_paid"])
    )

    if transaction.amount > remaining_balance:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=400,
            detail=(
                f"Transaction amount exceeds remaining "
                f"balance of {remaining_balance:.2f}"
            )
        )

    cursor.execute(
        """
        INSERT INTO PaymentTransaction
        (
            payment_id,
            amount,
            payment_mode
        )
        VALUES (%s, %s, %s)
        """,
        (
            transaction.payment_id,
            transaction.amount,
            transaction.payment_mode
        )
    )

    connection.commit()

    transaction_id = cursor.lastrowid

    cursor.close()
    connection.close()

    return {
        "message": "Transaction added successfully",
        "transaction_id": transaction_id,
        "amount": transaction.amount,
        "payment_mode": transaction.payment_mode
    }


# ============================================================
# PENDING PAYMENTS
# ============================================================

@app.get("/pending-payments")
def get_pending_payments(
        user: dict = Depends(require_admin)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM PendingPayments"
    )

    pending_payments = cursor.fetchall()

    cursor.close()
    connection.close()

    return pending_payments


# ============================================================
# CUSTOMER SELF-SERVICE
# ============================================================

@app.get("/customer/booking-config")
def customer_booking_config(
        user: dict = Depends(require_customer)
):
    return {
        "open": BUSINESS_OPEN,
        "close": BUSINESS_CLOSE,
        "step": TIME_SLOT_MINUTES,
        "locations": BOOKING_LOCATIONS
    }


# Legacy date-only listing. The new booking page uses
# POST /customer/vehicles/search instead; this is kept so
# nothing else that calls it breaks.
@app.get("/customer/vehicles")
def customer_list_vehicles(
        start_date: str | None = Query(default=None),
        end_date: str | None = Query(default=None),
        user: dict = Depends(require_customer)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    if start_date and end_date:

        cursor.execute(
            """
            SELECT
                v.vehicle_id,
                v.vehicle_name,
                v.type,
                v.rate_per_day,
                v.image_url,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM Rental r
                        WHERE r.vehicle_id = v.vehicle_id
                                                AND r.actual_return_date IS NULL
                        AND r.start_date <= %s
                        AND (
                            r.end_date >= %s
                            OR r.end_date < CURDATE()
                        )
                    )
                        THEN 0
                    ELSE 1
                END AS is_available
            FROM Vehicle v
            ORDER BY v.vehicle_name
            """,
            (
                end_date,
                start_date
            )
        )

    else:

        cursor.execute(
            """
            SELECT
                v.vehicle_id,
                v.vehicle_name,
                v.type,
                v.rate_per_day,
                v.image_url,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM Rental r
                        WHERE r.vehicle_id = v.vehicle_id
                        AND r.actual_return_date IS NULL

                    )
                        THEN 0
                    ELSE 1
                END AS is_available
            FROM Vehicle v
            ORDER BY v.vehicle_name
            """
        )

    vehicles = cursor.fetchall()

    cursor.close()
    connection.close()

    return vehicles


@app.post("/customer/vehicles/search")
def customer_search_vehicles(
        search: VehicleSearchRequest,
        user: dict = Depends(require_customer)
):
    pickup_time, dropoff_time = validate_booking_schedule(search)

    validate_location(search.pickup_location, "pickup location")
    validate_location(search.dropoff_location, "drop-off location")

    start_dt = to_datetime_str(search.start_date, pickup_time)
    end_dt = to_datetime_str(search.end_date, dropoff_time)

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        f"""
        SELECT
            v.vehicle_id,
            v.vehicle_name,
            v.type,
            v.rate_per_day,
            v.image_url,
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM Rental r
                    WHERE r.vehicle_id = v.vehicle_id
                    AND {BLOCKING_RENTAL_CONDITION}
                )
                    THEN 0
                ELSE 1
            END AS is_available
        FROM Vehicle v
        ORDER BY is_available DESC, v.vehicle_name
        """,
        (
            end_dt,
            start_dt
        )
    )

    vehicles = cursor.fetchall()

    cursor.close()
    connection.close()

    # Same hour-based formula as booking creation.
    for vehicle in vehicles:
        duration_hours, rental_amount = calculate_rental_charge(
            search.start_date,
            pickup_time,
            search.end_date,
            dropoff_time,
            vehicle["rate_per_day"]
        )

        vehicle["duration_hours"] = duration_hours
        vehicle["rental_amount"] = rental_amount

    return vehicles


@app.post("/customer/bookings")
def customer_create_booking(
        booking: CustomerBookingCreate,
        user: dict = Depends(require_customer)
):
    pickup_time, dropoff_time = validate_booking_schedule(booking)

    pickup_location = validate_location(
        booking.pickup_location,
        "pickup location"
    )

    dropoff_location = validate_location(
        booking.dropoff_location,
        "drop-off location"
    )

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT vehicle_id, vehicle_name, rate_per_day
        FROM Vehicle
        WHERE vehicle_id = %s
        """,
        (booking.vehicle_id,)
    )

    vehicle = cursor.fetchone()

    if not vehicle:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Vehicle not found"
        )

    # Same availability rule as the search endpoint.
    cursor.execute(
        f"""
        SELECT COUNT(*) AS overlap_count
        FROM Rental r
        WHERE r.vehicle_id = %s
        AND {BLOCKING_RENTAL_CONDITION}
        """,
        (
            booking.vehicle_id,
            to_datetime_str(booking.end_date, dropoff_time),
            to_datetime_str(booking.start_date, pickup_time)
        )
    )

    overlap = cursor.fetchone()

    if overlap and overlap["overlap_count"] > 0:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=409,
            detail="Vehicle is not available for the selected dates"
        )

    pillion_amount = (
        PILLION_ADDON_AMOUNT
        if booking.pillion_addon
        else 0.00
    )

    # Hour-based pricing from the booked pickup/drop-off datetimes.
    duration_hours, rental_amount = calculate_rental_charge(
        booking.start_date,
        pickup_time,
        booking.end_date,
        dropoff_time,
        vehicle["rate_per_day"]
    )

    total_amount = round(rental_amount + pillion_amount, 2)

    insert_cursor = connection.cursor()

    insert_cursor.execute(
        """
        INSERT INTO Rental
        (
            customer_id,
            vehicle_id,
            start_date,
            end_date,
            approval_status,
            pickup_time,
            dropoff_time,
            pickup_location,
            dropoff_location,
            pillion_addon,
            total_amount
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            user["customer_id"],
            booking.vehicle_id,
            booking.start_date,
            booking.end_date,
            "approved",
            pickup_time,
            dropoff_time,
            pickup_location,
            dropoff_location,
            pillion_amount,
            total_amount
        )
    )

    connection.commit()

    rental_id = insert_cursor.lastrowid

    insert_cursor.close()
    cursor.close()
    connection.close()

    return {
        "message": "Booking created successfully",
        "rental_id": rental_id,
        "vehicle_name": vehicle["vehicle_name"],
        "pickup_location": pickup_location,
        "dropoff_location": dropoff_location,
        "duration_hours": duration_hours,
        "rental_amount": rental_amount,
        "pillion_amount": pillion_amount,
        "total_amount": total_amount
    }


@app.get("/customer/bookings/mine")
def customer_list_my_bookings(
        user: dict = Depends(require_customer)
):
    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT
            r.rental_id,
            r.vehicle_id,
            v.vehicle_name,
            v.type,
            r.start_date,
            r.end_date,
            r.pickup_time,
            r.dropoff_time,
            r.pickup_location,
            r.dropoff_location,
            r.pillion_addon,
            r.total_amount,
            r.actual_return_date,
            ROUND(TIMESTAMPDIFF(
                MINUTE,
                TIMESTAMP(r.start_date, r.pickup_time),
                TIMESTAMP(r.end_date, r.dropoff_time)
            ) / 60, 2) AS duration_hours,
            p.payment_id,
            COALESCE(p.payment_status, 'Pending') AS payment_status,
            COALESCE(p.amount_paid, 0) AS amount_paid
        FROM Rental r
        JOIN Vehicle v
            ON r.vehicle_id = v.vehicle_id
        LEFT JOIN Payment p
            ON p.rental_id = r.rental_id
        WHERE r.customer_id = %s
        ORDER BY r.rental_id DESC
        """,
        (user["customer_id"],)
    )

    bookings = cursor.fetchall()

    cursor.close()
    connection.close()

    return bookings


@app.post("/customer/bookings/{rental_id}/pay")
def customer_pay_booking(
        rental_id: int,
        payment_request: CustomerPaymentRequest,
        user: dict = Depends(require_customer)
):
    allowed_modes = [
        "Cash",
        "Card",
        "UPI"
    ]

    if payment_request.payment_mode not in allowed_modes:
        raise HTTPException(
            status_code=400,
            detail="Payment mode must be Cash, Card, or UPI"
        )

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT rental_id, total_amount
        FROM Rental
        WHERE rental_id = %s
        AND customer_id = %s
        """,
        (
            rental_id,
            user["customer_id"]
        )
    )

    rental = cursor.fetchone()

    if not rental:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Booking not found"
        )

    cursor.execute(
        """
        SELECT payment_id, total_amount, amount_paid
        FROM Payment
        WHERE rental_id = %s
        """,
        (rental_id,)
    )

    payment = cursor.fetchone()

    write_cursor = connection.cursor()

    if not payment:

        write_cursor.execute(
            """
            INSERT INTO Payment
            (rental_id, total_amount, late_fee)
            VALUES (%s, %s, 0)
            """,
            (
                rental_id,
                rental["total_amount"]
            )
        )

        connection.commit()

        payment_id = write_cursor.lastrowid
        remaining_balance = float(rental["total_amount"])

    else:

        payment_id = payment["payment_id"]

        remaining_balance = (
                float(payment["total_amount"])
                - float(payment["amount_paid"])
        )

    if remaining_balance <= 0:
        write_cursor.close()
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=400,
            detail="This booking is already fully paid"
        )

    write_cursor.execute(
        """
        INSERT INTO PaymentTransaction
        (payment_id, amount, payment_mode)
        VALUES (%s, %s, %s)
        """,
        (
            payment_id,
            remaining_balance,
            payment_request.payment_mode
        )
    )

    connection.commit()

    write_cursor.close()
    cursor.close()
    connection.close()

    return {
        "message": "Payment successful (demo)",
        "rental_id": rental_id,
        "payment_id": payment_id,
        "amount_paid": remaining_balance,
        "payment_mode": payment_request.payment_mode
    }


# ============================================================
# SERVE FRONTEND
# ============================================================

if os.path.exists(frontend_path):
    app.mount(
        "/",
        StaticFiles(
            directory=frontend_path,
            html=True
        ),
        name="frontend"
    )
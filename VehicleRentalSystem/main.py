import os
import mysql.connector
import jwt
from datetime import datetime, timedelta, date
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
# Both admin and customer accounts can log in via /login below.
# Access to each endpoint is controlled by role, using the
# require_admin / require_customer dependencies further down.
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
    pillion_addon: bool = False


class CustomerPaymentRequest(BaseModel):
    payment_mode: str


PILLION_ADDON_AMOUNT = 100.00

# Rental-business operating window. Pickup and drop-off must fall on a
# slot inside it. No hours were defined in the project before, so these
# are a reasonable default; change them here and the frontend follows
# (it reads them from GET /customer/booking-config).
BUSINESS_OPEN = "08:00"
BUSINESS_CLOSE = "20:00"
TIME_SLOT_MINUTES = 30


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

    # Accept "HH:MM" or "HH:MM:SS" but only if seconds are zero.
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
        start = datetime.strptime(booking.start_date, "%Y-%m-%d").date()
        end = datetime.strptime(booking.end_date, "%Y-%m-%d").date()
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

    pickup = normalize_time(booking.pickup_time, "Pickup time")
    dropoff = normalize_time(booking.dropoff_time, "Drop-off time")

    if start == end and dropoff <= pickup:
        raise HTTPException(
            status_code=400,
            detail="Drop-off time must be later than pickup time on the same day"
        )

    return pickup, dropoff


def calculate_rental_days(start_date: str, end_date: str) -> int:

    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()

    days = (end - start).days

    if days < 0:
        raise HTTPException(
            status_code=400,
            detail="End date cannot be before start date"
        )

    return days if days > 0 else 1


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
# Shared login for both admin and customer accounts. The role
# in the Customer row decides what the token is issued for;
# it is NOT restricted to admin here. Each endpoint below still
# enforces its own required role via require_admin / require_customer.
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

    # No role restriction here — both "admin" and "customer" accounts
    # are allowed to log in. Access control happens per-endpoint via
    # require_admin / require_customer, not at login time.

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
# CUSTOMER MANAGEMENT (ADMIN-ONLY)
# CRUD over Customer records, restricted to admin. This is
# separate from customer self-service, which will use
# require_customer and only ever touch the caller's own row.
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
# RENTAL MANAGEMENT
# Plain CRUD. Every rental created here is admin-created, so it
# is always stored as "approved" — there is no pending/approval
# workflow (that only existed for the old customer-request flow).
# ============================================================

@app.get("/rentals")
def get_rentals(
    user: dict = Depends(require_admin)
):

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Rental"
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
# (This is a payments VIEW — unrelated to the old rental
# approval workflow, which has been removed.)
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
# Everything below is scoped to the logged-in customer via
# require_customer + user["customer_id"] taken from the JWT.
# A customer can never supply their own customer_id — it is
# always read from the verified token, never from the request
# body or URL. This is what keeps a customer from seeing or
# acting on anyone else's bookings/payments.
# ============================================================

@app.get("/customer/booking-config")
def customer_booking_config(
    user: dict = Depends(require_customer)
):

    return {
        "open": BUSINESS_OPEN,
        "close": BUSINESS_CLOSE,
        "step": TIME_SLOT_MINUTES
    }


@app.get("/customer/vehicles")
def customer_list_vehicles(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    user: dict = Depends(require_customer)
):

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    if start_date and end_date:

        # Availability for the SPECIFIC dates the customer searched,
        # matching the same overlap rule used when a booking is
        # actually created (see customer_create_booking below).
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
                        AND r.start_date <= %s
                        AND r.end_date >= %s
                    )
                        THEN 0
                    ELSE 1
                END AS is_available
            FROM Vehicle v
            ORDER BY v.vehicle_name
            """,
            (end_date, start_date)
        )

    else:

        # No dates given (e.g. just populating a type filter) — fall
        # back to "is it free right now" as a rough default.
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
                        AND r.end_date >= CURDATE()
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


@app.post("/customer/bookings")
def customer_create_booking(
    booking: CustomerBookingCreate,
    user: dict = Depends(require_customer)
):

    # Validate dates and 30-minute times server-side; never trust the UI.
    pickup_time, dropoff_time = validate_booking_schedule(booking)

    duration_days = calculate_rental_days(
        booking.start_date,
        booking.end_date
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

    cursor.execute(
        """
        SELECT COUNT(*) AS overlap_count
        FROM Rental
        WHERE vehicle_id = %s
        AND start_date <= %s
        AND end_date >= %s
        """,
        (
            booking.vehicle_id,
            booking.end_date,
            booking.start_date
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

    rental_amount = (
        float(vehicle["rate_per_day"])
        * duration_days
    )

    total_amount = rental_amount + pillion_amount

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
            pillion_addon,
            total_amount
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            user["customer_id"],
            booking.vehicle_id,
            booking.start_date,
            booking.end_date,
            "approved",
            pickup_time,
            dropoff_time,
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
        "duration_days": duration_days,
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
            r.pillion_addon,
            r.total_amount,
            r.actual_return_date,
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

    # Ownership check: the rental must belong to THIS customer.
    # A customer can never pay (or even see) another customer's
    # rental, because rental_id alone is not enough here — it
    # must also match user["customer_id"] from the token.
    cursor.execute(
        """
        SELECT rental_id, total_amount
        FROM Rental
        WHERE rental_id = %s
        AND customer_id = %s
        """,
        (rental_id, user["customer_id"])
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
            (rental_id, rental["total_amount"])
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

    # NOTE: this relies on the same mechanism the admin
    # /transactions endpoint relies on to keep Payment.amount_paid
    # and payment_status in sync after a PaymentTransaction insert
    # (e.g. a DB trigger). If that mechanism doesn't exist yet,
    # amount_paid/payment_status will need to be updated here too.
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
import os
import mysql.connector
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


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

# ------------------------------------------------------------
# DEBUG: confirms which file uvicorn is actually running
# ------------------------------------------------------------
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


class Vehicle(BaseModel):
    vehicle_name: str
    type: str
    rate_per_day: float


class Rental(BaseModel):
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


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
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
# CUSTOMER ENDPOINTS
# ============================================================

@app.get("/customers")
def get_customers():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("SELECT * FROM Customer")
    customers = cursor.fetchall()

    cursor.close()
    connection.close()

    return customers


@app.get("/customers/{customer_id}")
def get_customer(customer_id: int):

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Customer WHERE customer_id = %s",
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
def add_customer(customer: Customer):

    connection = get_db_connection()
    cursor = connection.cursor()

    query = """
        INSERT INTO Customer (name, phone, email)
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
    customer: Customer
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
def delete_customer(customer_id: int):

    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        "DELETE FROM Customer WHERE customer_id = %s",
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
# VEHICLE ENDPOINTS
# ============================================================

@app.get("/vehicles")
def get_vehicles():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("SELECT * FROM Vehicle")
    vehicles = cursor.fetchall()

    cursor.close()
    connection.close()

    return vehicles


@app.get("/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: int):

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Vehicle WHERE vehicle_id = %s",
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
def add_vehicle(vehicle: Vehicle):

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
    vehicle: Vehicle
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
def delete_vehicle(vehicle_id: int):

    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        "DELETE FROM Vehicle WHERE vehicle_id = %s",
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
# RENTAL ENDPOINTS
# ============================================================

@app.get("/rentals")
def get_rentals():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("SELECT * FROM Rental")
    rentals = cursor.fetchall()

    cursor.close()
    connection.close()

    return rentals


# ------------------------------------------------------------
# NEW: DASHBOARD SUMMARY (customer name, vehicle name, status)
# ------------------------------------------------------------
@app.get("/rentals/summary")
def get_rentals_summary():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            r.rental_id,
            c.name AS customer_name,
            v.vehicle_name,
            r.start_date,
            r.end_date,
            r.actual_return_date,
            CASE
                WHEN r.actual_return_date IS NOT NULL THEN 'Completed'
                WHEN r.end_date < CURDATE() THEN 'Overdue'
                ELSE 'Ongoing'
            END AS status
        FROM Rental r
        JOIN Customer c ON r.customer_id = c.customer_id
        JOIN Vehicle v ON r.vehicle_id = v.vehicle_id
        ORDER BY r.rental_id DESC
        LIMIT 10
    """)

    rentals = cursor.fetchall()

    cursor.close()
    connection.close()

    return rentals


@app.get("/rentals/{rental_id}")
def get_rental(rental_id: int):

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Rental WHERE rental_id = %s",
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
def add_rental(rental: Rental):

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

    query = """
        INSERT INTO Rental
        (
            customer_id,
            vehicle_id,
            start_date,
            end_date,
            actual_return_date
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
            rental.actual_return_date
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
    rental: Rental
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

    query = """
        UPDATE Rental
        SET customer_id = %s,
            vehicle_id = %s,
            start_date = %s,
            end_date = %s,
            actual_return_date = %s
        WHERE rental_id = %s
    """

    cursor.execute(
        query,
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
def delete_rental(rental_id: int):

    connection = get_db_connection()
    cursor = connection.cursor()

    try:

        cursor.execute(
            "DELETE FROM Rental WHERE rental_id = %s",
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
# PAYMENT ENDPOINTS
# ============================================================

@app.get("/payments")
def get_payments():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("SELECT * FROM Payment")
    payments = cursor.fetchall()

    cursor.close()
    connection.close()

    return payments


# ------------------------------------------------------------
# NEW: DASHBOARD SUMMARY (payment method, status)
# ------------------------------------------------------------
@app.get("/payments/summary")
def get_payments_summary():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("""
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
    """)

    payments = cursor.fetchall()

    cursor.close()
    connection.close()

    return payments


@app.get("/payments/{payment_id}")
def get_payment(payment_id: int):

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM Payment WHERE payment_id = %s",
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
def add_payment(payment: Payment):

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
    payment: Payment
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
def delete_payment(payment_id: int):

    connection = get_db_connection()
    cursor = connection.cursor()

    try:

        # Delete transactions first because
        # PaymentTransaction has a foreign key to Payment
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
# PAYMENT TRANSACTION ENDPOINTS
# ============================================================

@app.get("/transactions")
def get_transactions():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute("SELECT * FROM PaymentTransaction")
    transactions = cursor.fetchall()

    cursor.close()
    connection.close()

    return transactions


@app.get("/transactions/{transaction_id}")
def get_transaction(transaction_id: int):

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
def add_transaction(transaction: PaymentTransaction):

    # --------------------------------------------------------
    # Validate payment mode
    # --------------------------------------------------------

    allowed_modes = ["Cash", "Card", "UPI"]

    if transaction.payment_mode not in allowed_modes:
        raise HTTPException(
            status_code=400,
            detail="Payment mode must be Cash, Card, or UPI"
        )

    # --------------------------------------------------------
    # Validate amount
    # --------------------------------------------------------

    if transaction.amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Transaction amount must be greater than 0"
        )

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    # --------------------------------------------------------
    # Check payment exists
    # --------------------------------------------------------

    cursor.execute(
        """
        SELECT
            payment_id,
            total_amount,
            amount_paid
        FROM Payment
        WHERE payment_id = %s
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

    # --------------------------------------------------------
    # Calculate remaining balance
    # --------------------------------------------------------

    remaining_balance = (
        float(payment["total_amount"])
        - float(payment["amount_paid"])
    )

    if transaction.amount > remaining_balance:
        cursor.close()
        connection.close()

        raise HTTPException(
            status_code=400,
            detail=f"Transaction amount exceeds remaining balance of {remaining_balance:.2f}"
        )

    # --------------------------------------------------------
    # Insert transaction
    # --------------------------------------------------------

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
def get_pending_payments():

    connection = get_db_connection()
    cursor = connection.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM PendingPayments"
    )

    pending_payments = cursor.fetchall()

    cursor.close()
    connection.close()

    return pending_payments
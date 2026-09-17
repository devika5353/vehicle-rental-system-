"use strict";

const API_BASE_URL = "http://127.0.0.1:8001";

let appData = {
    customers: [],
    vehicles: [],
    rentals: [],
    payments: [],
    transactions: []
};

let editingId = null;


/* =========================================================
   START APPLICATION
========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
    setupNavigation();
    setupModals();
    setupButtons();
    setupForms();
    setupSearch();
    updateHeaderDate();

    await loadData();
});


/* =========================================================
   API
========================================================= */

async function api(endpoint, options = {}) {
    const response = await fetch(
        `${API_BASE_URL}${endpoint}`,
        {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        }
    );

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(
            data?.detail ||
            `Request failed: ${response.status}`
        );
    }

    return data;
}


/* =========================================================
   LOAD DATA FROM FASTAPI / MYSQL
========================================================= */

async function loadData() {

    console.log("Loading data from:", API_BASE_URL);

    try {
        appData.customers =
            (await api("/customers")).map(
                normalizeCustomer
            );

        console.log(
            "Customers:",
            appData.customers
        );

    } catch (error) {
        console.error(
            "Customers failed:",
            error
        );

        appData.customers = [];
    }


    try {
        appData.vehicles =
            (await api("/vehicles")).map(
                normalizeVehicle
            );

        console.log(
            "Vehicles:",
            appData.vehicles
        );

    } catch (error) {
        console.error(
            "Vehicles failed:",
            error
        );

        appData.vehicles = [];
    }


    try {
        appData.rentals =
            (await api("/rentals")).map(
                normalizeRental
            );

        console.log(
            "Rentals:",
            appData.rentals
        );

    } catch (error) {
        console.error(
            "Rentals failed:",
            error
        );

        appData.rentals = [];
    }


    try {
        appData.payments =
            (await api("/payments")).map(
                normalizePayment
            );

        console.log(
            "Payments:",
            appData.payments
        );

    } catch (error) {
        console.error(
            "Payments failed:",
            error
        );

        appData.payments = [];
    }


    try {
        appData.transactions =
            (await api("/transactions")).map(
                normalizeTransaction
            );

        console.log(
            "Transactions:",
            appData.transactions
        );

    } catch (error) {
        console.error(
            "Transactions failed:",
            error
        );

        appData.transactions = [];
    }


    updateDerivedData();

    renderAll();

    updateDashboard();

    console.log(
        "Final application data:",
        appData
    );
}


/* =========================================================
   NORMALIZE DATABASE DATA
========================================================= */

function normalizeCustomer(customer) {

    return {
        id: String(
            customer.customer_id ??
            customer.id ??
            ""
        ),

        full_name:
            customer.name ??
            customer.full_name ??
            "",

        phone:
            customer.phone ??
            "",

        email:
            customer.email ??
            "",

        license_number:
            customer.license_number ??
            "",

        address:
            customer.address ??
            ""
    };
}


function normalizeVehicle(vehicle) {

    return {
        id: String(
            vehicle.vehicle_id ??
            vehicle.id ??
            ""
        ),

        model:
            vehicle.vehicle_name ??
            vehicle.model ??
            "",

        type:
            vehicle.type ??
            "",

        daily_rate:
            Number(
                vehicle.rate_per_day ??
                vehicle.daily_rate ??
                0
            ),

        availability_status:
            "available"
    };
}


function normalizeRental(rental) {

    const startDate =
        String(
            rental.start_date ??
            rental.rental_date ??
            ""
        ).slice(0, 10);


    const endDate =
        String(
            rental.end_date ??
            rental.expected_return_date ??
            ""
        ).slice(0, 10);


    const actualReturnDate =
        rental.actual_return_date
            ? String(
                rental.actual_return_date
            ).slice(0, 10)
            : "";


    return {
        id: String(
            rental.rental_id ??
            rental.id ??
            ""
        ),

        customer_id:
            String(
                rental.customer_id ??
                ""
            ),

        vehicle_id:
            String(
                rental.vehicle_id ??
                ""
            ),

        rental_date:
            startDate,

        expected_return_date:
            endDate,

        actual_return_date:
            actualReturnDate,

        status:
            getRentalStatus(
                endDate,
                actualReturnDate
            )
    };
}


function normalizePayment(payment) {

    return {
        id: String(
            payment.payment_id ??
            payment.id ??
            ""
        ),

        rental_id:
            String(
                payment.rental_id ??
                ""
            ),

        amount:
            Number(
                payment.amount_paid ??
                payment.amount ??
                0
            ),

        total_amount:
            Number(
                payment.total_amount ??
                0
            ),

        late_fee:
            Number(
                payment.late_fee ??
                0
            ),

        status:
            String(
                payment.payment_status ??
                payment.status ??
                "Pending"
            ).toLowerCase()
    };
}


function normalizeTransaction(transaction) {

    return {
        id: String(
            transaction.transaction_id ??
            transaction.id ??
            ""
        ),

        payment_id:
            String(
                transaction.payment_id ??
                ""
            ),

        amount:
            Number(
                transaction.amount ??
                0
            ),

        payment_method:
            transaction.payment_mode ??
            transaction.payment_method ??
            "",

        date:
            String(
                transaction.transaction_date ??
                transaction.date ??
                ""
            ).slice(0, 10)
    };
}


/* =========================================================
   DERIVED DATA
========================================================= */

function getRentalStatus(
    endDate,
    actualReturnDate
) {

    if (actualReturnDate) {
        return "completed";
    }

    if (
        endDate &&
        endDate < today()
    ) {
        return "overdue";
    }

    return "active";
}


function updateDerivedData() {

    appData.rentals =
        appData.rentals.map(
            rental => ({
                ...rental,

                status:
                    getRentalStatus(
                        rental.expected_return_date,
                        rental.actual_return_date
                    )
            })
        );


    appData.vehicles =
        appData.vehicles.map(
            vehicle => {

                const rented =
                    appData.rentals.some(
                        rental =>
                            rental.vehicle_id ===
                                vehicle.id &&
                            rental.status ===
                                "active"
                    );

                return {
                    ...vehicle,

                    availability_status:
                        rented
                            ? "rented"
                            : "available"
                };
            }
        );
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {

    document
        .querySelectorAll(
            ".nav-item, [data-section]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                event => {

                    const section =
                        event.currentTarget
                            .dataset.section;

                    if (section) {
                        showSection(section);
                    }
                }
            );
        });
}


function showSection(sectionName) {

    document
        .querySelectorAll(
            ".content-section"
        )
        .forEach(section => {

            section.classList.remove(
                "active",
                "active-section"
            );
        });


    const section =
        document.getElementById(
            sectionName
        );


    if (section) {

        section.classList.add(
            "active",
            "active-section"
        );
    }


    document
        .querySelectorAll(
            ".nav-item"
        )
        .forEach(item => {

            item.classList.toggle(
                "active",
                item.dataset.section ===
                    sectionName
            );
        });


    const titles = {

        dashboard:
            "Dashboard",

        customers:
            "Customers",

        vehicles:
            "Vehicles",

        rentals:
            "Rentals",

        payments:
            "Payments",

        transactions:
            "Transactions"
    };


    const pageTitle =
        document.getElementById(
            "pageTitle"
        );


    if (pageTitle) {

        pageTitle.textContent =
            titles[sectionName] ||
            "Dashboard";
    }
}


/* =========================================================
   MODALS
========================================================= */

function setupModals() {

    document
        .querySelectorAll(
            ".modal-overlay"
        )
        .forEach(modal => {

            modal.addEventListener(
                "click",
                event => {

                    if (
                        event.target ===
                        modal
                    ) {

                        closeModal(
                            modal.id
                        );
                    }
                }
            );
        });


    document
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    closeModal(
                        button.dataset
                            .closeModal
                    );
                }
            );
        });
}


function openModal(
    modalId,
    type,
    record = null
) {

    const modal =
        document.getElementById(
            modalId
        );


    if (!modal) {
        return;
    }


    editingId =
        record?.id ??
        null;


    const form =
        modal.querySelector(
            "form"
        );


    if (form) {
        form.reset();
    }


    if (type === "rental") {
        fillRentalDropdowns();
    }


    if (type === "payment") {
        fillPaymentDropdown();
    }


    if (record) {
        fillForm(
            type,
            record
        );
    } else {
        setDefaults(type);
    }


    modal.classList.add(
        "active"
    );
}


function closeModal(modalId) {

    const modal =
        document.getElementById(
            modalId
        );


    if (!modal) {
        return;
    }


    modal.classList.remove(
        "active"
    );


    editingId = null;
}


/* =========================================================
   BUTTONS
========================================================= */

function setupButtons() {

    bind(
        "addCustomerBtn",
        () => openModal(
            "customerModal",
            "customer"
        )
    );


    bind(
        "addVehicleBtn",
        () => openModal(
            "vehicleModal",
            "vehicle"
        )
    );


    bind(
        "addRentalBtn",
        () => openModal(
            "rentalModal",
            "rental"
        )
    );


    bind(
        "addPaymentBtn",
        () => openModal(
            "paymentModal",
            "payment"
        )
    );


    bind(
        "quickAddCustomer",
        () => openModal(
            "customerModal",
            "customer"
        )
    );


    bind(
        "quickAddVehicle",
        () => openModal(
            "vehicleModal",
            "vehicle"
        )
    );


    bind(
        "quickCreateRental",
        () => openModal(
            "rentalModal",
            "rental"
        )
    );


    bind(
        "quickRecordPayment",
        () => openModal(
            "paymentModal",
            "payment"
        )
    );
}


/* =========================================================
   FORMS
========================================================= */

function setupForms() {

    bindForm(
        "customerForm",
        saveCustomer
    );


    bindForm(
        "vehicleForm",
        saveVehicle
    );


    bindForm(
        "rentalForm",
        saveRental
    );


    bindForm(
        "paymentForm",
        savePayment
    );


    const rentalDate =
        document.getElementById(
            "rentalDate"
        );


    const expectedReturnDate =
        document.getElementById(
            "expectedReturnDate"
        );


    rentalDate?.addEventListener(
        "change",
        () => {

            if (expectedReturnDate) {

                expectedReturnDate.min =
                    rentalDate.value;
            }
        }
    );
}


/* =========================================================
   CUSTOMER
========================================================= */

async function saveCustomer(event) {

    event.preventDefault();


    const name =
        value(
            "customerName"
        ).trim();

    const phone =
        value(
            "customerPhone"
        ).trim();

    const email =
        value(
            "customerEmail"
        ).trim();


    if (
        !name ||
        !phone ||
        !email
    ) {

        showToast(
            "Please fill in all required customer fields.",
            "error"
        );

        return;
    }


    const data = {
        name,
        phone,
        email
    };


    try {

        if (editingId) {

            await api(
                `/customers/${editingId}`,
                {
                    method: "PUT",
                    body:
                        JSON.stringify(data)
                }
            );

            showToast(
                "Customer updated.",
                "success"
            );

        } else {

            await api(
                "/customers",
                {
                    method: "POST",
                    body:
                        JSON.stringify(data)
                }
            );

            showToast(
                "Customer added.",
                "success"
            );
        }


        closeModal(
            "customerModal"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   VEHICLE
========================================================= */

async function saveVehicle(event) {

    event.preventDefault();


    const model =
        value(
            "vehicleModel"
        ).trim();

    const type =
        value(
            "vehicleType"
        ).trim();

    const rate =
        Number(
            value(
                "ratePerDay"
            )
        );


    if (
        !model ||
        !type ||
        !Number.isFinite(rate) ||
        rate < 0
    ) {

        showToast(
            "Please enter valid vehicle details.",
            "error"
        );

        return;
    }


    const data = {

        vehicle_name:
            model,

        type:
            type,

        rate_per_day:
            rate
    };


    try {

        if (editingId) {

            await api(
                `/vehicles/${editingId}`,
                {
                    method: "PUT",
                    body:
                        JSON.stringify(data)
                }
            );

            showToast(
                "Vehicle updated.",
                "success"
            );

        } else {

            await api(
                "/vehicles",
                {
                    method: "POST",
                    body:
                        JSON.stringify(data)
                }
            );

            showToast(
                "Vehicle added.",
                "success"
            );
        }


        closeModal(
            "vehicleModal"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   RENTAL
========================================================= */

async function saveRental(event) {

    event.preventDefault();


    const customerId =
        value(
            "rentalCustomer"
        );

    const vehicleId =
        value(
            "rentalVehicle"
        );

    const startDate =
        value(
            "rentalDate"
        );

    const endDate =
        value(
            "expectedReturnDate"
        );

    const status =
        value(
            "rentalStatus"
        );


    if (
        !customerId ||
        !vehicleId ||
        !startDate ||
        !endDate
    ) {

        showToast(
            "Please complete the rental form.",
            "error"
        );

        return;
    }


    if (
        endDate <
        startDate
    ) {

        showToast(
            "Return date cannot be before rental date.",
            "error"
        );

        return;
    }


    const customerExists =
        appData.customers.some(
            customer =>
                customer.id ===
                String(customerId)
        );


    if (!customerExists) {

        showToast(
            "Selected customer does not exist.",
            "error"
        );

        return;
    }


    const vehicle =
        appData.vehicles.find(
            item =>
                item.id ===
                String(vehicleId)
        );


    if (!vehicle) {

        showToast(
            "Selected vehicle does not exist.",
            "error"
        );

        return;
    }


    const otherActiveRental =
        appData.rentals.find(
            rental =>
                rental.id !==
                    String(editingId) &&
                rental.vehicle_id ===
                    String(vehicleId) &&
                rental.status ===
                    "active"
        );


    if (
        status === "active" &&
        otherActiveRental
    ) {

        showToast(
            "That vehicle is already rented.",
            "error"
        );

        return;
    }


    const data = {

        customer_id:
            Number(customerId),

        vehicle_id:
            Number(vehicleId),

        start_date:
            startDate,

        end_date:
            endDate,

        actual_return_date:
            status === "completed"
                ? endDate
                : null
    };


    try {

        if (editingId) {

            await api(
                `/rentals/${editingId}`,
                {
                    method: "PUT",
                    body:
                        JSON.stringify(data)
                }
            );

            showToast(
                "Rental updated.",
                "success"
            );

        } else {

            await api(
                "/rentals",
                {
                    method: "POST",
                    body:
                        JSON.stringify(data)
                }
            );

            showToast(
                "Rental created.",
                "success"
            );
        }


        closeModal(
            "rentalModal"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   PAYMENT
========================================================= */

async function savePayment(event) {

    event.preventDefault();


    const rentalId =
        value(
            "paymentRental"
        );

    const amount =
        Number(
            value(
                "paymentAmount"
            )
        );

    let method =
        value(
            "paymentMethod"
        );


    method =
        normalizePaymentMethod(
            method
        );


    if (
        !rentalId ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !method
    ) {

        showToast(
            "Please enter valid payment details.",
            "error"
        );

        return;
    }


    if (
        ![
            "Cash",
            "Card",
            "UPI"
        ].includes(method)
    ) {

        showToast(
            "Only Cash, Card and UPI are supported by the database.",
            "error"
        );

        return;
    }


    const rentalExists =
        appData.rentals.some(
            rental =>
                rental.id ===
                String(rentalId)
        );


    if (!rentalExists) {

        showToast(
            "Selected rental does not exist.",
            "error"
        );

        return;
    }


    try {

        let payment =
            appData.payments.find(
                item =>
                    item.rental_id ===
                    String(rentalId)
            );


        let paymentId;


        if (payment) {

            paymentId =
                Number(
                    payment.id
                );

        } else {

            payment =
                await api(
                    "/payments",
                    {
                        method: "POST",

                        body:
                            JSON.stringify({

                                rental_id:
                                    Number(
                                        rentalId
                                    ),

                                total_amount:
                                    amount,

                                late_fee:
                                    0
                            })
                    }
                );


            paymentId =
                Number(
                    payment.payment_id ??
                    payment.id
                );
        }


        await api(
            "/transactions",
            {
                method: "POST",

                body:
                    JSON.stringify({

                        payment_id:
                            paymentId,

                        amount:
                            amount,

                        payment_mode:
                            method
                    })
            }
        );


        closeModal(
            "paymentModal"
        );


        showToast(
            "Payment recorded.",
            "success"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   RENTAL DROPDOWNS
========================================================= */

function fillRentalDropdowns() {

    const customerSelect =
        document.getElementById(
            "rentalCustomer"
        );


    const vehicleSelect =
        document.getElementById(
            "rentalVehicle"
        );


    if (customerSelect) {

        customerSelect.innerHTML =
            `<option value="">
                Select customer
            </option>`;


        appData.customers.forEach(
            customer => {

                customerSelect.add(
                    new Option(
                        `${customer.full_name} (#${customer.id})`,
                        customer.id
                    )
                );
            }
        );
    }


    if (vehicleSelect) {

        vehicleSelect.innerHTML =
            `<option value="">
                Select available vehicle
            </option>`;


        appData.vehicles.forEach(
            vehicle => {

                const rented =
                    appData.rentals.some(
                        rental =>
                            rental.vehicle_id ===
                                vehicle.id &&
                            rental.status ===
                                "active" &&
                            rental.id !==
                                String(
                                    editingId
                                )
                    );


                const option =
                    new Option(
                        `${vehicle.model} - ${capitalize(vehicle.type)}`,
                        vehicle.id
                    );


                option.disabled =
                    rented;


                vehicleSelect.add(
                    option
                );
            }
        );
    }
}


/* =========================================================
   PAYMENT DROPDOWN
========================================================= */

function fillPaymentDropdown() {

    const select =
        document.getElementById(
            "paymentRental"
        );


    if (!select) {
        return;
    }


    select.innerHTML =
        `<option value="">
            Select rental
        </option>`;


    appData.rentals.forEach(
        rental => {

            const customer =
                appData.customers.find(
                    item =>
                        item.id ===
                        rental.customer_id
                );


            const vehicle =
                appData.vehicles.find(
                    item =>
                        item.id ===
                        rental.vehicle_id
                );


            select.add(
                new Option(
                    `#${rental.id} - ${customer?.full_name || "Unknown"} - ${vehicle?.model || "Unknown"}`,
                    rental.id
                )
            );
        }
    );
}


/* =========================================================
   FILL EDIT FORMS
========================================================= */

function fillForm(
    type,
    record
) {

    if (type === "customer") {

        setValue(
            "customerName",
            record.full_name
        );

        setValue(
            "customerPhone",
            record.phone
        );

        setValue(
            "customerEmail",
            record.email
        );

        setValue(
            "licenseNumber",
            record.license_number
        );

        setValue(
            "customerAddress",
            record.address
        );
    }


    if (type === "vehicle") {

        setValue(
            "vehicleType",
            record.type
        );

        setValue(
            "vehicleModel",
            record.model
        );

        setValue(
            "ratePerDay",
            record.daily_rate
        );

        setValue(
            "availabilityStatus",
            record.availability_status
        );
    }


    if (type === "rental") {

        setValue(
            "rentalCustomer",
            record.customer_id
        );

        setValue(
            "rentalVehicle",
            record.vehicle_id
        );

        setValue(
            "rentalDate",
            record.rental_date
        );

        setValue(
            "expectedReturnDate",
            record.expected_return_date
        );

        setValue(
            "rentalStatus",
            record.status
        );
    }


    if (type === "payment") {

        setValue(
            "paymentRental",
            record.rental_id
        );

        setValue(
            "paymentAmount",
            record.amount
        );

        setValue(
            "paymentStatus",
            record.status
        );
    }
}


/* =========================================================
   DEFAULT FORM VALUES
========================================================= */

function setDefaults(type) {

    if (type === "rental") {

        setValue(
            "rentalDate",
            today()
        );

        setValue(
            "rentalStatus",
            "active"
        );


        const expectedReturnDate =
            document.getElementById(
                "expectedReturnDate"
            );


        if (expectedReturnDate) {
            expectedReturnDate.min =
                today();
        }
    }


    if (type === "payment") {

        setValue(
            "paymentDate",
            today()
        );
    }
}


/* =========================================================
   RENDER ALL
========================================================= */

function renderAll() {

    renderCustomers();

    renderVehicles();

    renderRentals();

    renderPayments();

    renderTransactions();
}


/* =========================================================
   CUSTOMERS TABLE
========================================================= */

function renderCustomers() {

    const tbody =
        document.querySelector(
            "#customersTable tbody"
        );


    if (!tbody) {
        return;
    }


    const search =
        value(
            "customerSearch"
        ).toLowerCase();


    const rows =
        appData.customers.filter(
            customer =>
                `${customer.id} ${customer.full_name} ${customer.phone} ${customer.email}`
                    .toLowerCase()
                    .includes(search)
        );


    if (!rows.length) {

        emptyTable(
            tbody,
            5,
            "No customers found"
        );

        return;
    }


    tbody.innerHTML =
        rows.map(
            customer => `

            <tr>

                <td>
                    #${escapeHTML(
                        customer.id
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        customer.full_name
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        customer.phone
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        customer.email
                    )}
                </td>

                <td>

                    <div class="action-buttons">

                        <button
                            class="action-button"
                            onclick="editCustomer('${safeAttr(customer.id)}')"
                        >
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        <button
                            class="action-button danger-action"
                            onclick="deleteCustomer('${safeAttr(customer.id)}')"
                        >
                            <i class="fa-solid fa-trash"></i>
                        </button>

                    </div>

                </td>

            </tr>

        `
        ).join("");
}


/* =========================================================
   VEHICLES TABLE
========================================================= */

function renderVehicles() {

    const tbody =
        document.querySelector(
            "#vehiclesTable tbody"
        );


    if (!tbody) {
        return;
    }


    const search =
        value(
            "vehicleSearch"
        ).toLowerCase();


    const filter =
        value(
            "vehicleStatusFilter"
        );


    const rows =
        appData.vehicles.filter(
            vehicle => {

                const matchesSearch =
                    `${vehicle.id} ${vehicle.model} ${vehicle.type}`
                        .toLowerCase()
                        .includes(search);


                const matchesFilter =
                    !filter ||
                    filter === "all" ||
                    vehicle.availability_status ===
                        filter;


                return (
                    matchesSearch &&
                    matchesFilter
                );
            }
        );


    if (!rows.length) {

        emptyTable(
            tbody,
            7,
            "No vehicles found"
        );

        return;
    }


    tbody.innerHTML =
        rows.map(
            vehicle => `

            <tr>

                <td>
                    #${escapeHTML(
                        vehicle.id
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        capitalize(
                            vehicle.type
                        )
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        vehicle.model
                    )}
                </td>

                <td>
                    ₹${Number(
                        vehicle.daily_rate
                    ).toLocaleString(
                        "en-IN"
                    )}
                </td>

                <td>
                    ${badge(
                        vehicle.availability_status
                    )}
                </td>

                <td>

                    <div class="action-buttons">

                        <button
                            class="action-button"
                            onclick="editVehicle('${safeAttr(vehicle.id)}')"
                        >
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        <button
                            class="action-button danger-action"
                            onclick="deleteVehicle('${safeAttr(vehicle.id)}')"
                        >
                            <i class="fa-solid fa-trash"></i>
                        </button>

                    </div>

                </td>

            </tr>

        `
        ).join("");
}


/* =========================================================
   RENTALS TABLE
========================================================= */

function renderRentals() {

    const tbody =
        document.querySelector(
            "#rentalsTable tbody"
        );


    if (!tbody) {

        console.error(
            "Rental table body not found. Expected #rentalsTable tbody"
        );

        return;
    }


    const search =
        value(
            "rentalSearch"
        ).toLowerCase();


    const filter =
        value(
            "rentalStatusFilter"
        ).toLowerCase();


    const rows =
        appData.rentals.filter(
            rental => {

                const customer =
                    appData.customers.find(
                        item =>
                            item.id ===
                            rental.customer_id
                    );


                const vehicle =
                    appData.vehicles.find(
                        item =>
                            item.id ===
                            rental.vehicle_id
                    );


                const searchableText =
                    `${rental.id} ${customer?.full_name || ""} ${vehicle?.model || ""} ${vehicle?.type || ""} ${rental.customer_id} ${rental.vehicle_id}`
                        .toLowerCase();


                const matchesSearch =
                    searchableText.includes(
                        search
                    );


                const matchesFilter =
                    !filter ||
                    filter === "all" ||
                    rental.status ===
                        filter;


                return (
                    matchesSearch &&
                    matchesFilter
                );
            }
        );


    console.log(
        "Rendering rentals:",
        rows
    );


    if (!rows.length) {

        emptyTable(
            tbody,
            7,
            "No rentals found"
        );

        return;
    }


    tbody.innerHTML =
        rows.map(
            rental => `

            <tr>

                <td>
                    <strong>
                        #${escapeHTML(
                            rental.id
                        )}
                    </strong>
                </td>

                <td>
                    ${escapeHTML(
                        getCustomerName(
                            rental.customer_id
                        )
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        getVehicleName(
                            rental.vehicle_id
                        )
                    )}
                </td>

                <td>
                    ${formatDate(
                        rental.rental_date
                    )}
                </td>

                <td>
                    ${formatDate(
                        rental.expected_return_date
                    )}
                </td>

                <td>
                    ${badge(
                        rental.status
                    )}
                </td>

                <td>

                    <div class="action-buttons">

                        <button
                            class="action-button"
                            onclick="editRental('${safeAttr(rental.id)}')"
                            title="Edit"
                        >
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        <button
                            class="action-button danger-action"
                            onclick="deleteRental('${safeAttr(rental.id)}')"
                            title="Delete"
                        >
                            <i class="fa-solid fa-trash"></i>
                        </button>

                    </div>

                </td>

            </tr>

        `
        ).join("");
}


/* =========================================================
   PAYMENTS TABLE
========================================================= */

function renderPayments() {

    const tbody =
        document.querySelector(
            "#paymentsTable tbody"
        );


    if (!tbody) {
        return;
    }


    const search =
        value(
            "paymentSearch"
        ).toLowerCase();


    const filter =
        value(
            "paymentStatusFilter"
        ).toLowerCase();


    const rows =
        appData.payments.filter(
            payment => {

                const searchableText =
                    `${payment.id} ${payment.rental_id} ${payment.status}`
                        .toLowerCase();


                return (
                    searchableText.includes(
                        search
                    ) &&
                    (
                        !filter ||
                        filter === "all" ||
                        payment.status ===
                            filter
                    )
                );
            }
        );


    if (!rows.length) {

        emptyTable(
            tbody,
            7,
            "No payments found"
        );

        return;
    }


    tbody.innerHTML =
        rows.map(
            payment => {

                const transaction =
                    appData.transactions
                        .filter(
                            item =>
                                item.payment_id ===
                                payment.id
                        )
                        .sort(
                            (a, b) =>
                                b.date.localeCompare(
                                    a.date
                                )
                        )[0];


                return `

                    <tr>

                        <td>
                            #${escapeHTML(
                                payment.id
                            )}
                        </td>

                        <td>
                            #${escapeHTML(
                                payment.rental_id
                            )}
                        </td>

                        <td>
                            ₹${Number(
                                payment.amount
                            ).toLocaleString(
                                "en-IN",
                                {
                                    minimumFractionDigits:
                                        2
                                }
                            )}
                        </td>

                        <td>
                            ${formatDate(
                                transaction?.date
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                transaction?.payment_method ||
                                "—"
                            )}
                        </td>

                        <td>
                            ${badge(
                                payment.status
                            )}
                        </td>

                        <td>

                            <div class="action-buttons">

                                <button
                                    class="action-button"
                                    onclick="editPayment('${safeAttr(payment.id)}')"
                                >
                                    <i class="fa-solid fa-pen"></i>
                                </button>

                                <button
                                    class="action-button danger-action"
                                    onclick="deletePayment('${safeAttr(payment.id)}')"
                                >
                                    <i class="fa-solid fa-trash"></i>
                                </button>

                            </div>

                        </td>

                    </tr>

                `;
            }
        ).join("");
}


/* =========================================================
   TRANSACTIONS TABLE
========================================================= */

function renderTransactions() {

    const tbody =
        document.querySelector(
            "#transactionsTable tbody"
        );


    if (!tbody) {
        return;
    }


    const search =
        value(
            "transactionSearch"
        ).toLowerCase();


    const rows =
        appData.transactions.filter(
            transaction =>
                `${transaction.id} ${transaction.payment_id} ${transaction.amount} ${transaction.payment_method}`
                    .toLowerCase()
                    .includes(search)
        );


    if (!rows.length) {

        emptyTable(
            tbody,
            6,
            "No transactions found"
        );

        return;
    }


    tbody.innerHTML =
        rows.map(
            transaction => `

            <tr>

                <td>
                    #${escapeHTML(
                        transaction.id
                    )}
                </td>

                <td>
                    #${escapeHTML(
                        transaction.payment_id
                    )}
                </td>

                <td>
                    ${formatDate(
                        transaction.date
                    )}
                </td>

                <td>
                    ₹${Number(
                        transaction.amount
                    ).toLocaleString(
                        "en-IN",
                        {
                            minimumFractionDigits:
                                2
                        }
                    )}
                </td>

                <td>
                    ${badge(
                        "success"
                    )}
                </td>

                <td>
                    —
                </td>

            </tr>

        `
        ).join("");
}


/* =========================================================
   SEARCH AND FILTER
========================================================= */

function setupSearch() {

    const searchFields = [

        "customerSearch",
        "vehicleSearch",
        "rentalSearch",
        "paymentSearch",
        "transactionSearch"
    ];


    searchFields.forEach(
        id => {

            document
                .getElementById(id)
                ?.addEventListener(
                    "input",
                    renderAll
                );
        }
    );


    const filterFields = [

        "vehicleStatusFilter",
        "rentalStatusFilter",
        "paymentStatusFilter"
    ];


    filterFields.forEach(
        id => {

            document
                .getElementById(id)
                ?.addEventListener(
                    "change",
                    renderAll
                );
        }
    );
}


/* =========================================================
   EDIT
========================================================= */

function editCustomer(id) {

    const customer =
        appData.customers.find(
            item =>
                item.id ===
                String(id)
        );


    if (customer) {

        openModal(
            "customerModal",
            "customer",
            customer
        );
    }
}


function editVehicle(id) {

    const vehicle =
        appData.vehicles.find(
            item =>
                item.id ===
                String(id)
        );


    if (vehicle) {

        openModal(
            "vehicleModal",
            "vehicle",
            vehicle
        );
    }
}


function editRental(id) {

    const rental =
        appData.rentals.find(
            item =>
                item.id ===
                String(id)
        );


    if (rental) {

        openModal(
            "rentalModal",
            "rental",
            rental
        );
    }
}


function editPayment(id) {

    const payment =
        appData.payments.find(
            item =>
                item.id ===
                String(id)
        );


    if (payment) {

        openModal(
            "paymentModal",
            "payment",
            payment
        );
    }
}


/* =========================================================
   DELETE CUSTOMER
========================================================= */

async function deleteCustomer(id) {

    if (
        !confirm(
            "Delete this customer?"
        )
    ) {
        return;
    }


    try {

        await api(
            `/customers/${id}`,
            {
                method: "DELETE"
            }
        );


        showToast(
            "Customer deleted.",
            "success"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DELETE VEHICLE
========================================================= */

async function deleteVehicle(id) {

    if (
        !confirm(
            "Delete this vehicle?"
        )
    ) {
        return;
    }


    try {

        await api(
            `/vehicles/${id}`,
            {
                method: "DELETE"
            }
        );


        showToast(
            "Vehicle deleted.",
            "success"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DELETE RENTAL
========================================================= */

async function deleteRental(id) {

    if (
        !confirm(
            "Delete this rental?"
        )
    ) {
        return;
    }


    try {

        await api(
            `/rentals/${id}`,
            {
                method: "DELETE"
            }
        );


        showToast(
            "Rental deleted.",
            "success"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DELETE PAYMENT
========================================================= */

async function deletePayment(id) {

    if (
        !confirm(
            "Delete this payment and its transactions?"
        )
    ) {
        return;
    }


    try {

        await api(
            `/payments/${id}`,
            {
                method: "DELETE"
            }
        );


        showToast(
            "Payment deleted.",
            "success"
        );


        await loadData();

    } catch (error) {

        console.error(error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DASHBOARD
========================================================= */

function updateDashboard() {

    const totalVehicles =
        appData.vehicles.length;


    const totalCustomers =
        appData.customers.length;


    const activeRentals =
        appData.rentals.filter(
            rental =>
                rental.status ===
                "active"
        ).length;


    const completedRentals =
        appData.rentals.filter(
            rental =>
                rental.status ===
                "completed"
        ).length;


    const overdueRentals =
        appData.rentals.filter(
            rental =>
                rental.status ===
                "overdue"
        ).length;


    const availableVehicles =
        appData.vehicles.filter(
            vehicle =>
                vehicle.availability_status ===
                "available"
        ).length;


    const rentedVehicles =
        appData.vehicles.filter(
            vehicle =>
                vehicle.availability_status ===
                "rented"
        ).length;


    const totalRevenue =
        appData.transactions.reduce(
            (total, transaction) =>
                total +
                Number(
                    transaction.amount || 0
                ),
            0
        );


    const pendingPayments =
        appData.payments.filter(
            payment =>
                payment.status ===
                    "pending" ||
                payment.status ===
                    "partial"
        ).length;


    setText(
        "totalVehicles",
        totalVehicles
    );


    setText(
        "totalCustomers",
        totalCustomers
    );


    setText(
        "activeRentals",
        activeRentals
    );


    setText(
        "totalRevenue",
        `₹${totalRevenue.toLocaleString(
            "en-IN"
        )}`
    );


    setText(
        "availableVehicles",
        availableVehicles
    );


    setText(
        "availabilityTotal",
        totalVehicles
    );


    setText(
        "legendAvailable",
        availableVehicles
    );


    setText(
        "legendRented",
        rentedVehicles
    );


    setText(
        "legendMaintenance",
        0
    );


    setText(
        "completedRentals",
        completedRentals
    );


    setText(
        "pendingPayments",
        pendingPayments
    );


    setText(
        "overdueRentals",
        overdueRentals
    );


    const vehicleTypes = [
        "sedan",
        "suv",
        "hatchback",
        "van"
    ];


    vehicleTypes.forEach(
        type => {

            setText(
                `type${capitalize(type)}`,
                appData.vehicles.filter(
                    vehicle =>
                        String(
                            vehicle.type
                        ).toLowerCase() ===
                        type
                ).length
            );
        }
    );
}


/* =========================================================
   HELPERS
========================================================= */

function bind(
    id,
    functionToRun
) {

    document
        .getElementById(id)
        ?.addEventListener(
            "click",
            functionToRun
        );
}


function bindForm(
    id,
    functionToRun
) {

    document
        .getElementById(id)
        ?.addEventListener(
            "submit",
            functionToRun
        );
}


function value(id) {

    return (
        document
            .getElementById(id)
            ?.value ||
        ""
    );
}


function setValue(
    id,
    newValue
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.value =
            newValue ?? "";
    }
}


function setText(
    id,
    newValue
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.textContent =
            newValue;
    }
}


function getCustomerName(
    customerId
) {

    return (
        appData.customers.find(
            customer =>
                customer.id ===
                String(
                    customerId
                )
        )?.full_name ||
        `Customer #${customerId}`
    );
}


function getVehicleName(
    vehicleId
) {

    return (
        appData.vehicles.find(
            vehicle =>
                vehicle.id ===
                String(
                    vehicleId
                )
        )?.model ||
        `Vehicle #${vehicleId}`
    );
}


function today() {

    const date =
        new Date();


    return [

        date.getFullYear(),

        String(
            date.getMonth() + 1
        ).padStart(2, "0"),

        String(
            date.getDate()
        ).padStart(2, "0")

    ].join("-");
}


function formatDate(date) {

    if (!date) {
        return "—";
    }


    const parts =
        String(date)
            .slice(0, 10)
            .split("-");


    if (parts.length !== 3) {
        return "—";
    }


    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    ).toLocaleDateString(
        "en-IN",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );
}


function capitalize(text) {

    const value =
        String(
            text || ""
        );


    if (!value) {
        return "";
    }


    return (
        value.charAt(0).toUpperCase() +
        value.slice(1)
    );
}


function normalizePaymentMethod(
    method
) {

    const value =
        String(
            method || ""
        ).toLowerCase();


    if (value === "cash") {
        return "Cash";
    }


    if (value === "card") {
        return "Card";
    }


    if (value === "upi") {
        return "UPI";
    }


    return method;
}


function badge(status) {

    const value =
        String(
            status ||
            "unknown"
        ).toLowerCase();


    let className =
        "neutral";


    if (
        [
            "available",
            "active",
            "success",
            "completed"
        ].includes(value)
    ) {

        className =
            "success";
    }


    if (
        [
            "pending",
            "partial",
            "maintenance"
        ].includes(value)
    ) {

        className =
            "warning";
    }


    if (
        [
            "rented",
            "overdue",
            "failed",
            "cancelled"
        ].includes(value)
    ) {

        className =
            "danger";
    }


    return `
        <span class="badge badge-${className}">
            ${escapeHTML(
                capitalize(value)
            )}
        </span>
    `;
}


function emptyTable(
    tbody,
    colspan,
    message
) {

    tbody.innerHTML = `

        <tr>

            <td
                colspan="${colspan}"
                class="table-empty"
            >
                ${escapeHTML(
                    message
                )}
            </td>

        </tr>

    `;
}


function safeAttr(value) {

    return escapeHTML(
        String(value ?? "")
    );
}


function escapeHTML(value) {

    return String(
        value ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


/* =========================================================
   TOAST
========================================================= */

function showToast(
    message,
    type = "success"
) {

    let container =
        document.getElementById(
            "toastContainer"
        );


    if (!container) {

        container =
            document.createElement(
                "div"
            );


        container.id =
            "toastContainer";


        container.style.position =
            "fixed";


        container.style.right =
            "20px";


        container.style.bottom =
            "20px";


        container.style.zIndex =
            "9999";


        document.body.appendChild(
            container
        );
    }


    const toast =
        document.createElement(
            "div"
        );


    toast.textContent =
        message;


    toast.style.padding =
        "12px 18px";


    toast.style.marginTop =
        "10px";


    toast.style.borderRadius =
        "8px";


    toast.style.background =
        type === "error"
            ? "#b42318"
            : "#16794c";


    toast.style.color =
        "white";


    toast.style.fontSize =
        "14px";


    container.appendChild(
        toast
    );


    setTimeout(
        () => {
            toast.remove();
        },
        3500
    );
}


/* =========================================================
   HEADER DATE
========================================================= */

function updateHeaderDate() {

    const element =
        document.getElementById(
            "currentDate"
        );


    if (element) {

        element.textContent =
            new Date()
                .toLocaleDateString(
                    "en-IN",
                    {
                        weekday:
                            "long",

                        day:
                            "2-digit",

                        month:
                            "short",

                        year:
                            "numeric"
                    }
                );
    }
}


/* =========================================================
   MAKE FUNCTIONS AVAILABLE TO HTML
========================================================= */

window.editCustomer =
    editCustomer;

window.deleteCustomer =
    deleteCustomer;

window.editVehicle =
    editVehicle;

window.deleteVehicle =
    deleteVehicle;

window.editRental =
    editRental;

window.deleteRental =
    deleteRental;

window.editPayment =
    editPayment;

window.deletePayment =
    deletePayment;
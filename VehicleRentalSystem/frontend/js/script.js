"use strict";

const API_BASE_URL = window.location.origin;

let appData = {
    customers: [],
    vehicles: [],
    rentals: [],
    payments: [],
    transactions: [],
    pendingPayments: []
};

let editingId = null;
let currentUser = null;


/* =========================================================
   START APPLICATION
========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

    setupLogin();

    const savedUser = localStorage.getItem("user");

    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            await routeUser();
        } catch {
            localStorage.removeItem("user");
        }
    }
});


/* =========================================================
   LOGIN
   Both admin and customer accounts can log in through the same
   form. After a successful login, routeUser() sends admins to
   the existing admin dashboard and customers to the customer
   booking page.
========================================================= */

function setupLogin() {

    document.getElementById("loginForm")?.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();

            const email =
                document.getElementById("loginEmail").value.trim();

            const password =
                document.getElementById("loginPassword").value.trim();

            const errorEl =
                document.getElementById("loginError");

            if (errorEl) {
                errorEl.textContent = "";
            }

            try {

                const user = await api("/login", {
                    method: "POST",
                    body: JSON.stringify({
                        email,
                        password
                    })
                });

                currentUser = user;

                localStorage.setItem(
                    "user",
                    JSON.stringify(user)
                );

                await routeUser();

            } catch (error) {

                if (errorEl) {
                    errorEl.textContent =
                        error.message ||
                        "Invalid email or password";
                }
            }
        }
    );

    document.getElementById("logoutBtn")?.addEventListener(
        "click",
        () => {
            localStorage.removeItem("user");
            window.location.reload();
        }
    );
}


/* =========================================================
   ROUTE USER BY ROLE
   Single point of branching after login (both the "just logged
   in" path and the "restored from localStorage" path go through
   here). Admin behavior is exactly what showApp() already did.
   Customer behavior is a placeholder until the booking page is
   built.
========================================================= */

async function routeUser() {

    if (!currentUser || !currentUser.role) {

        localStorage.removeItem("user");
        window.location.reload();
        return;
    }

    if (currentUser.role === "admin") {

        await showApp();
        return;
    }

    if (currentUser.role === "customer") {

        showCustomerBooking();
        return;
    }

    showToast(
        "Unrecognized account role.",
        "error"
    );

    localStorage.removeItem("user");
}


async function showApp() {

    const loginOverlay =
        document.getElementById("loginOverlay");

    const appContainer =
        document.getElementById("appContainer");

    if (loginOverlay) {
        loginOverlay.style.display = "none";
    }

    if (appContainer) {
        appContainer.style.display = "";
    }

    const avatarEl =
        document.querySelector(".avatar");

    const nameEl =
        document.querySelector(".user-info strong");

    const roleEl =
        document.querySelector(".user-info span");

    if (avatarEl) {
        avatarEl.textContent = "AD";
    }

    if (nameEl) {
        nameEl.textContent =
            currentUser.name;
    }

    if (roleEl) {
        roleEl.textContent = "Administrator";
    }

    setupNavigation();
    setupModals();
    setupButtons();
    setupForms();
    setupSearch();
    updateHeaderDate();

    await loadData();
}


/* =========================================================
   CUSTOMER BOOKING PAGE (DrivePrime)
   One page: Vehicle -> Dates & times -> Extras -> Price -> Payment.
   The backend re-validates and re-prices everything on submit.
========================================================= */

const PILLION_ADDON_FEE = 100;

// Fallback slots; replaced by GET /customer/booking-config when available.
const DEFAULT_BUSINESS_HOURS = { open: "08:00", close: "20:00", step: 30 };

let customerVehicles = [];
let customerLastBooking = null;
let customerTimeSlots = [];

const customerState = {
    vehicle: null,
    type: "",
    startDate: "",
    endDate: "",
    pickupTime: "",
    dropoffTime: "",
    pillion: false,
    paymentMode: "Card"
};


function buildTimeSlots(cfg) {

    const toMin = t => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
    };

    const slots = [];

    for (let m = toMin(cfg.open); m <= toMin(cfg.close); m += cfg.step) {
        slots.push(
            String(Math.floor(m / 60)).padStart(2, "0") + ":" +
            String(m % 60).padStart(2, "0")
        );
    }

    return slots;
}


// Accepts "HH:MM[:SS]", seconds (number) or ISO "PT9H30M" — MySQL TIME
// columns can arrive in any of these shapes depending on the driver.
function customerFormatTime(value) {

    if (value === null || value === undefined || value === "") {
        return "";
    }

    if (typeof value === "number") {
        const h = Math.floor(value / 3600);
        const m = Math.floor((value % 3600) / 60);
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }

    const iso = String(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);

    if (iso) {
        return String(iso[1] || 0).padStart(2, "0") + ":" +
            String(iso[2] || 0).padStart(2, "0");
    }

    return String(value).slice(0, 5);
}


function customerInr(value) {
    return "₹" + Number(value || 0).toLocaleString("en-IN");
}


function customerRentalDays() {

    const { startDate, endDate } = customerState;

    if (!startDate || !endDate || endDate < startDate) {
        return 0;
    }

    const days = Math.round(
        (new Date(endDate) - new Date(startDate)) / 86400000
    );

    return days > 0 ? days : 1;
}


function showCustomerBooking() {

    const loginOverlay = document.getElementById("loginOverlay");
    const appContainer = document.getElementById("appContainer");

    if (loginOverlay) { loginOverlay.style.display = "none"; }
    if (appContainer) { appContainer.style.display = "none"; }

    let container = document.getElementById("customerAppContainer");

    if (!container) {
        container = document.createElement("div");
        container.id = "customerAppContainer";
        document.body.appendChild(container);
    }

    container.style.display = "";

    container.innerHTML = `
        <div class="cp">
            <header class="cp-header">
                <div class="cp-header-inner">
                    <a class="cp-brand" href="#" id="custBrand" aria-label="DrivePrime home">
                        <span class="cp-brand-mark"><i class="fa-solid fa-car-side"></i></span>
                        <span class="cp-brand-name">DrivePrime</span>
                    </a>
                    <nav class="cp-nav" aria-label="Customer navigation">
                        <button id="custNavVehicles" class="cp-nav-link active" type="button">Vehicles</button>
                        <button id="custNavBookings" class="cp-nav-link" type="button">My Bookings</button>
                        <span class="cp-user">${escapeHTML(currentUser.name)}</span>
                        <button id="customerLogoutBtn" class="cp-nav-link cp-logout" type="button">Logout</button>
                    </nav>
                </div>
            </header>
            <main id="customerMain" class="cp-main"></main>
        </div>
    `;

    document.getElementById("customerLogoutBtn")
        ?.addEventListener("click", () => {
            localStorage.removeItem("user");
            window.location.reload();
        });

    const goVehicles = e => {
        e?.preventDefault();
        customerShowBookingPage();
    };

    document.getElementById("custNavVehicles")?.addEventListener("click", goVehicles);
    document.getElementById("custBrand")?.addEventListener("click", goVehicles);
    document.getElementById("custNavBookings")?.addEventListener("click", customerShowMyBookings);

    customerShowBookingPage();
}


function customerMain() {
    return document.getElementById("customerMain");
}


function customerSetActiveNav(id) {

    ["custNavVehicles", "custNavBookings"].forEach(navId => {
        document.getElementById(navId)
            ?.classList.toggle("active", navId === id);
    });
}


/* ---------- Booking page ---------- */

async function customerShowBookingPage() {

    const main = customerMain();

    if (!main) { return; }

    customerSetActiveNav("custNavVehicles");

    // Business hours: use the server's definition so both sides agree.
    if (!customerTimeSlots.length) {

        let cfg = DEFAULT_BUSINESS_HOURS;

        try {
            cfg = await api("/customer/booking-config");
        } catch {
            // fall back to defaults
        }

        customerTimeSlots = buildTimeSlots(cfg);
    }

    const timeOptions = customerTimeSlots
        .map(t => `<option value="${t}">${t}</option>`)
        .join("");

    const todayValue = today();

    main.innerHTML = `
        <ol class="cp-steps" id="cpSteps">
            <li data-step="1">Choose vehicle</li>
            <li data-step="2">Dates &amp; times</li>
            <li data-step="3">Extras</li>
            <li data-step="4">Review price</li>
            <li data-step="5">Payment</li>
        </ol>

        <div class="cp-layout">
            <div class="cp-col-main">

                <section class="cp-card" aria-labelledby="cpVehiclesTitle">
                    <div class="cp-card-head">
                        <h2 id="cpVehiclesTitle">Choose your vehicle</h2>
                        <div class="cp-chips" id="cpTypeChips" role="group" aria-label="Filter by vehicle type"></div>
                    </div>
                    <div id="cpVehicleGrid" class="cp-vehicle-grid">
                        <p class="cp-muted">Loading vehicles…</p>
                    </div>
                </section>

                <section class="cp-card" aria-labelledby="cpDetailsTitle">
                    <h2 id="cpDetailsTitle">Rental details</h2>

                    <div class="cp-grid-2">
                        <fieldset class="cp-fieldset">
                            <legend>Pickup</legend>
                            <div class="cp-row">
                                <label class="cp-field">
                                    <span>Date</span>
                                    <input type="date" id="cpStartDate" min="${todayValue}">
                                </label>
                                <label class="cp-field">
                                    <span>Time</span>
                                    <select id="cpPickupTime" class="cp-select">
                                        <option value="">Select time</option>${timeOptions}
                                    </select>
                                </label>
                            </div>
                        </fieldset>

                        <fieldset class="cp-fieldset">
                            <legend>Drop-off</legend>
                            <div class="cp-row">
                                <label class="cp-field">
                                    <span>Date</span>
                                    <input type="date" id="cpEndDate" min="${todayValue}">
                                </label>
                                <label class="cp-field">
                                    <span>Time</span>
                                    <select id="cpDropoffTime" class="cp-select">
                                        <option value="">Select time</option>${timeOptions}
                                    </select>
                                </label>
                            </div>
                        </fieldset>
                    </div>

                    <label class="cp-check">
                        <input type="checkbox" id="cpPillion">
                        <span>
                            <strong>Pillion add-on</strong>
                            <small>Adds a rider seat, ${customerInr(PILLION_ADDON_FEE)} flat</small>
                        </span>
                    </label>
                </section>
            </div>

            <aside class="cp-col-side">
                <section class="cp-card cp-summary" aria-labelledby="cpSummaryTitle">
                    <h2 id="cpSummaryTitle">Price summary</h2>
                    <div id="cpSelected" class="cp-selected">No vehicle selected</div>

                    <dl class="cp-lines">
                        <div><dt>Rental days</dt><dd id="cpSumDays">—</dd></div>
                        <div><dt>Vehicle rental</dt><dd id="cpSumRental">₹0</dd></div>
                        <div><dt>Pillion add-on</dt><dd id="cpSumPillion">₹0</dd></div>
                        <div class="cp-total"><dt>Total</dt><dd id="cpSumTotal">₹0</dd></div>
                    </dl>

                    <label class="cp-field cp-pay">
                        <span>Payment mode</span>
                        <select id="cpPaymentMode" class="cp-select">
                            <option value="Card">Card</option>
                            <option value="UPI">UPI</option>
                            <option value="Cash">Cash</option>
                        </select>
                    </label>

                    <p id="cpError" class="cp-error" role="alert"></p>

                    <button id="cpConfirmBtn" class="cp-cta" type="button">Confirm booking</button>
                    <p class="cp-fine">Demo payment. No real charge is made.</p>
                </section>
            </aside>
        </div>
    `;

    const $ = id => document.getElementById(id);

    $("cpStartDate").value = customerState.startDate;
    $("cpEndDate").value = customerState.endDate;
    $("cpPickupTime").value = customerState.pickupTime;
    $("cpDropoffTime").value = customerState.dropoffTime;
    $("cpPillion").checked = customerState.pillion;
    $("cpPaymentMode").value = customerState.paymentMode;

    $("cpStartDate").addEventListener("change", () => {
        customerState.startDate = $("cpStartDate").value;

        // Drop-off can never precede pickup.
        const endEl = $("cpEndDate");
        endEl.min = customerState.startDate || todayValue;

        if (customerState.endDate && customerState.endDate < customerState.startDate) {
            customerState.endDate = "";
            endEl.value = "";
        }

        customerOnScheduleChange();
    });

    $("cpEndDate").addEventListener("change", () => {
        customerState.endDate = $("cpEndDate").value;
        customerOnScheduleChange();
    });

    $("cpPickupTime").addEventListener("change", () => {
        customerState.pickupTime = $("cpPickupTime").value;
        customerOnScheduleChange(false);
    });

    $("cpDropoffTime").addEventListener("change", () => {
        customerState.dropoffTime = $("cpDropoffTime").value;
        customerOnScheduleChange(false);
    });

    $("cpPillion").addEventListener("change", () => {
        customerState.pillion = $("cpPillion").checked;
        customerUpdateSummary();
    });

    $("cpPaymentMode").addEventListener("change", () => {
        customerState.paymentMode = $("cpPaymentMode").value;
        customerUpdateSummary();
    });

    $("cpConfirmBtn").addEventListener("click", customerConfirmBooking);

    if (customerState.endDate === "" && customerState.startDate) {
        $("cpEndDate").min = customerState.startDate;
    }

    customerRefreshDropoffTimes();
    customerUpdateSummary();
    customerLoadVehicles();
}


// Same-day rentals: drop-off must be later than pickup.
function customerRefreshDropoffTimes() {

    const select = document.getElementById("cpDropoffTime");

    if (!select) { return; }

    const sameDay =
        customerState.startDate &&
        customerState.startDate === customerState.endDate;

    Array.from(select.options).forEach(opt => {
        opt.disabled =
            Boolean(sameDay && opt.value && customerState.pickupTime &&
                opt.value <= customerState.pickupTime);
    });

    if (select.selectedOptions[0]?.disabled) {
        select.value = "";
        customerState.dropoffTime = "";
    }
}


function customerOnScheduleChange(refetch = true) {

    customerRefreshDropoffTimes();
    customerUpdateSummary();

    if (refetch && customerState.startDate && customerState.endDate) {
        customerLoadVehicles();
    }
}


async function customerLoadVehicles() {

    const grid = document.getElementById("cpVehicleGrid");

    if (!grid) { return; }

    const { startDate, endDate } = customerState;

    const query =
        startDate && endDate && endDate >= startDate
            ? `?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
            : "";

    try {
        customerVehicles = await api(`/customer/vehicles${query}`);
    } catch (error) {
        grid.innerHTML =
            `<p class="cp-error">${escapeHTML(error.message || "Unable to load vehicles.")}</p>`;
        return;
    }

    // A previously selected vehicle may no longer be free for new dates.
    if (customerState.vehicle) {

        const fresh = customerVehicles.find(
            v => v.vehicle_id === customerState.vehicle.vehicle_id
        );

        if (!fresh || Number(fresh.is_available) !== 1) {
            customerState.vehicle = null;
            const errorEl = document.getElementById("cpError");
            if (errorEl) {
                errorEl.textContent =
                    "Your selected vehicle isn't available for these dates. Please choose another.";
            }
        } else {
            customerState.vehicle = fresh;
        }
    }

    customerRenderTypeChips();
    customerRenderVehicleCards();
    customerUpdateSummary();
}


function customerRenderTypeChips() {

    const wrap = document.getElementById("cpTypeChips");

    if (!wrap) { return; }

    const types = [...new Set(customerVehicles.map(v => v.type).filter(Boolean))];

    if (types.length < 2) {
        wrap.innerHTML = "";
        return;
    }

    wrap.innerHTML = ["", ...types].map(type => `
        <button type="button"
                class="cp-chip${customerState.type === type ? " active" : ""}"
                data-type="${escapeHTML(type)}"
                aria-pressed="${customerState.type === type}">
            ${type ? escapeHTML(capitalize(type)) : "All"}
        </button>
    `).join("");

    wrap.querySelectorAll(".cp-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            customerState.type = btn.dataset.type;
            customerRenderTypeChips();
            customerRenderVehicleCards();
        });
    });
}


function customerVehicleIcon(type) {

    const t = String(type || "").toLowerCase();

    if (t.includes("bike") || t.includes("scooter") || t.includes("motor")) {
        return "fa-motorcycle";
    }

    if (t.includes("suv") || t.includes("van") || t.includes("truck")) {
        return "fa-truck-pickup";
    }

    return "fa-car-side";
}


function customerRenderVehicleCards() {

    const grid = document.getElementById("cpVehicleGrid");

    if (!grid) { return; }

    const list = customerState.type
        ? customerVehicles.filter(v => v.type === customerState.type)
        : customerVehicles;

    if (!list.length) {
        grid.innerHTML = `<p class="cp-muted">No vehicles to show right now.</p>`;
        return;
    }

    grid.innerHTML = "";

    list.forEach(vehicle => {

        const available = Number(vehicle.is_available) === 1;
        const selected = customerState.vehicle?.vehicle_id === vehicle.vehicle_id;

        const card = document.createElement("article");
        card.className =
            "cp-vehicle" +
            (selected ? " selected" : "") +
            (available ? "" : " unavailable");

        // image_url comes from the Vehicle table; no invented URLs.
        const media = vehicle.image_url
            ? `<img src="${escapeHTML(vehicle.image_url)}" alt="${escapeHTML(vehicle.vehicle_name)}" loading="lazy">`
            : `<i class="fa-solid ${customerVehicleIcon(vehicle.type)}" aria-hidden="true"></i>`;

        card.innerHTML = `
            <div class="cp-vehicle-media${vehicle.image_url ? "" : " placeholder"}">${media}</div>
            <div class="cp-vehicle-body">
                <h3>${escapeHTML(vehicle.vehicle_name)}</h3>
                <p class="cp-muted">${escapeHTML(capitalize(vehicle.type || ""))}</p>
                <div class="cp-vehicle-foot">
                    <div class="cp-price">${customerInr(vehicle.rate_per_day)}<small> / day</small></div>
                    <span class="cp-avail ${available ? "ok" : "no"}">${available ? "Available" : "Booked"}</span>
                </div>
                <button type="button" class="cp-select-btn" ${available ? "" : "disabled"}>
                    ${selected ? "Selected" : available ? "Select vehicle" : "Unavailable"}
                </button>
            </div>
        `;

        card.querySelector("button")?.addEventListener("click", () => {
            customerState.vehicle = vehicle;
            const errorEl = document.getElementById("cpError");
            if (errorEl) { errorEl.textContent = ""; }
            customerRenderVehicleCards();
            customerUpdateSummary();
        });

        grid.appendChild(card);
    });
}


function customerUpdateSummary() {

    const $ = id => document.getElementById(id);

    const { vehicle, pillion, startDate, endDate, pickupTime, dropoffTime } = customerState;

    const days = customerRentalDays();
    const rental = vehicle ? Number(vehicle.rate_per_day) * (days || 0) : 0;
    const pillionAmount = pillion ? PILLION_ADDON_FEE : 0;
    const total = vehicle && days ? rental + pillionAmount : 0;

    if ($("cpSelected")) {
        $("cpSelected").innerHTML = vehicle
            ? `<strong>${escapeHTML(vehicle.vehicle_name)}</strong>
               <span>${customerInr(vehicle.rate_per_day)} / day</span>`
            : "No vehicle selected";
    }

    if ($("cpSumDays")) {
        $("cpSumDays").textContent = days ? `${days}` : "—";
        $("cpSumRental").textContent = customerInr(rental);
        $("cpSumPillion").textContent = customerInr(pillionAmount);
        $("cpSumTotal").textContent = customerInr(total);
    }

    // Progress: each step lights up once its inputs are complete.
    const done = [
        Boolean(vehicle),
        Boolean(startDate && endDate && pickupTime && dropoffTime),
        pillion,
        Boolean(vehicle && days),
        false
    ];

    let firstOpen = done.findIndex(d => !d);

    // Extras are optional, so never let them block progress.
    if (firstOpen === 2) { firstOpen = done[3] ? 4 : 3; }

    document.querySelectorAll("#cpSteps li").forEach((li, i) => {
        const complete = i === 2 ? Boolean(vehicle && startDate && endDate) : done[i];
        li.classList.toggle("done", complete && i !== 4);
        li.classList.toggle("active", i === firstOpen);
    });
}


function customerValidate() {

    const { vehicle, startDate, endDate, pickupTime, dropoffTime } = customerState;

    if (!vehicle) { return "Choose a vehicle to continue."; }

    if (!startDate || !pickupTime) { return "Select a pickup date and time."; }

    if (!endDate || !dropoffTime) { return "Select a drop-off date and time."; }

    if (startDate < today()) { return "Pickup date can't be in the past."; }

    if (endDate < startDate) { return "Drop-off date can't be before pickup date."; }

    if (!customerTimeSlots.includes(pickupTime) || !customerTimeSlots.includes(dropoffTime)) {
        return "Pickup and drop-off times must be on the half hour.";
    }

    if (startDate === endDate && dropoffTime <= pickupTime) {
        return "Drop-off time must be later than pickup time on the same day.";
    }

    return "";
}


async function customerConfirmBooking() {

    const errorEl = document.getElementById("cpError");
    const btn = document.getElementById("cpConfirmBtn");

    if (errorEl) { errorEl.textContent = ""; }

    const problem = customerValidate();

    if (problem) {
        if (errorEl) { errorEl.textContent = problem; }
        return;
    }

    const s = customerState;

    if (btn) { btn.disabled = true; btn.textContent = "Confirming…"; }

    let booking;

    try {
        booking = await api("/customer/bookings", {
            method: "POST",
            body: JSON.stringify({
                vehicle_id: Number(s.vehicle.vehicle_id),
                start_date: s.startDate,
                end_date: s.endDate,
                pickup_time: s.pickupTime,
                dropoff_time: s.dropoffTime,
                pillion_addon: s.pillion
            })
        });
    } catch (error) {
        if (errorEl) { errorEl.textContent = error.message || "Unable to create booking."; }
        if (btn) { btn.disabled = false; btn.textContent = "Confirm booking"; }
        return;
    }

    customerLastBooking = {
        ...booking,
        pickup_time: s.pickupTime,
        dropoff_time: s.dropoffTime,
        start_date: s.startDate,
        end_date: s.endDate
    };

    try {
        await api(`/customer/bookings/${booking.rental_id}/pay`, {
            method: "POST",
            body: JSON.stringify({ payment_mode: s.paymentMode })
        });
    } catch (error) {
        // Booking exists but payment failed: let the customer retry it
        // rather than creating a duplicate booking.
        customerShowPaymentStep(error.message || "Payment failed.");
        return;
    }

    customerShowConfirmation(s.paymentMode);
}


/* ---------- Payment retry (booking exists, payment didn't go through) ---------- */

function customerShowPaymentStep(message = "") {

    const main = customerMain();

    if (!main || !customerLastBooking) { return; }

    const b = customerLastBooking;

    main.innerHTML = `
        <section class="cp-card cp-narrow">
            <h2>Complete your payment</h2>
            <p class="cp-muted">${escapeHTML(b.vehicle_name)} · booking #${escapeHTML(b.rental_id)}. This is a demo payment.</p>

            <dl class="cp-lines">
                <div><dt>Vehicle rental</dt><dd>${customerInr(b.rental_amount)}</dd></div>
                <div><dt>Pillion add-on</dt><dd>${customerInr(b.pillion_amount)}</dd></div>
                <div class="cp-total"><dt>Total</dt><dd>${customerInr(b.total_amount)}</dd></div>
            </dl>

            <label class="cp-field cp-pay">
                <span>Payment mode</span>
                <select id="custPaymentMethod" class="cp-select">
                    <option value="Card">Card</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                </select>
            </label>

            <p id="custPaymentError" class="cp-error" role="alert">${escapeHTML(message)}</p>
            <button id="custPayBtn" class="cp-cta" type="button">Pay now</button>
        </section>
    `;

    document.getElementById("custPayBtn")
        ?.addEventListener("click", customerSubmitPayment);
}


async function customerSubmitPayment() {

    if (!customerLastBooking) { return; }

    const errorEl = document.getElementById("custPaymentError");
    const mode = document.getElementById("custPaymentMethod")?.value || "Card";

    if (errorEl) { errorEl.textContent = ""; }

    try {
        await api(`/customer/bookings/${customerLastBooking.rental_id}/pay`, {
            method: "POST",
            body: JSON.stringify({ payment_mode: mode })
        });
        customerShowConfirmation(mode);
    } catch (error) {
        if (errorEl) { errorEl.textContent = error.message || "Payment failed."; }
    }
}


/* ---------- Confirmation ---------- */

function customerShowConfirmation(mode) {

    const main = customerMain();

    if (!main || !customerLastBooking) { return; }

    const b = customerLastBooking;

    const when = b.start_date
        ? `${formatDate(b.start_date)}, ${escapeHTML(customerFormatTime(b.pickup_time))} to ${formatDate(b.end_date)}, ${escapeHTML(customerFormatTime(b.dropoff_time))}`
        : "";

    main.innerHTML = `
        <section class="cp-card cp-narrow cp-done">
            <div class="cp-done-icon"><i class="fa-solid fa-circle-check"></i></div>
            <h2>Booking confirmed</h2>
            <p class="cp-muted">Demo payment received by ${escapeHTML(mode)}. Booking #${escapeHTML(b.rental_id)}.</p>

            <dl class="cp-lines">
                <div><dt>Vehicle</dt><dd>${escapeHTML(b.vehicle_name)}</dd></div>
                ${when ? `<div><dt>Schedule</dt><dd>${when}</dd></div>` : ""}
                <div><dt>Rental days</dt><dd>${escapeHTML(b.duration_days ?? "—")}</dd></div>
                <div class="cp-total"><dt>Total paid</dt><dd>${customerInr(b.total_amount)}</dd></div>
            </dl>

            <div class="cp-actions">
                <button id="custBookAnother" class="cp-btn-ghost" type="button">Book another vehicle</button>
                <button id="custViewBookings" class="cp-cta" type="button">View my bookings</button>
            </div>
        </section>
    `;

    // Reset the form for the next booking.
    Object.assign(customerState, {
        vehicle: null, startDate: "", endDate: "",
        pickupTime: "", dropoffTime: "", pillion: false
    });

    document.getElementById("custBookAnother")
        ?.addEventListener("click", customerShowBookingPage);

    document.getElementById("custViewBookings")
        ?.addEventListener("click", customerShowMyBookings);
}


/* ---------- My bookings ---------- */

async function customerShowMyBookings() {

    const main = customerMain();

    if (!main) { return; }

    customerSetActiveNav("custNavBookings");

    main.innerHTML = `<p class="cp-muted">Loading your bookings…</p>`;

    let bookings = [];

    try {
        bookings = await api("/customer/bookings/mine");
    } catch (error) {
        main.innerHTML =
            `<p class="cp-error">${escapeHTML(error.message || "Unable to load bookings.")}</p>`;
        return;
    }

    if (!bookings.length) {
        main.innerHTML = `
            <section class="cp-card cp-narrow">
                <h2>My bookings</h2>
                <p class="cp-muted">You haven't booked a vehicle yet.</p>
                <button id="custBookFirst" class="cp-cta" type="button">Choose a vehicle</button>
            </section>
        `;
        document.getElementById("custBookFirst")
            ?.addEventListener("click", customerShowBookingPage);
        return;
    }

    main.innerHTML = `
        <h2 class="cp-page-title">My bookings</h2>
        <div id="custBookingsList" class="cp-bookings"></div>
    `;

    const list = document.getElementById("custBookingsList");

    bookings.forEach(booking => {

        const isPaid = String(booking.payment_status).toLowerCase() === "paid";

        const row = document.createElement("article");
        row.className = "cp-booking";

        row.innerHTML = `
            <div>
                <h3>${escapeHTML(booking.vehicle_name)}</h3>
                <p class="cp-muted">
                    #${escapeHTML(booking.rental_id)} ·
                    ${formatDate(booking.start_date)} ${escapeHTML(customerFormatTime(booking.pickup_time))}
                    to ${formatDate(booking.end_date)} ${escapeHTML(customerFormatTime(booking.dropoff_time))}
                </p>
            </div>
            <div class="cp-booking-right">
                <span class="cp-avail ${isPaid ? "ok" : "warn"}">${isPaid ? "Paid" : "Payment pending"}</span>
                <strong>${customerInr(booking.total_amount)}</strong>
            </div>
        `;

        if (!isPaid) {

            const payBtn = document.createElement("button");
            payBtn.className = "cp-cta cp-cta-sm";
            payBtn.type = "button";
            payBtn.textContent = "Complete payment";

            payBtn.addEventListener("click", () => {
                customerLastBooking = {
                    rental_id: booking.rental_id,
                    vehicle_name: booking.vehicle_name,
                    duration_days: null,
                    rental_amount:
                        Number(booking.total_amount) - Number(booking.pillion_addon || 0),
                    pillion_amount: Number(booking.pillion_addon || 0),
                    total_amount: Number(booking.total_amount),
                    start_date: booking.start_date,
                    end_date: booking.end_date,
                    pickup_time: booking.pickup_time,
                    dropoff_time: booking.dropoff_time
                };
                customerShowPaymentStep();
            });

            row.querySelector(".cp-booking-right").appendChild(payBtn);
        }

        list.appendChild(row);
    });
}



/* =========================================================
   API
========================================================= */

async function api(endpoint, options = {}) {

    const token =
        currentUser?.access_token;

    const response =
        await fetch(
            `${API_BASE_URL}${endpoint}`,
            {
                ...options,
                headers: {
                    "Content-Type": "application/json",

                    ...(token
                        ? {
                            "Authorization":
                                `Bearer ${token}`
                        }
                        : {}),

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

        let errorMessage =
            `Request failed: ${response.status}`;

        if (typeof data?.detail === "string") {

            errorMessage =
                data.detail;

        } else if (Array.isArray(data?.detail)) {

            errorMessage =
                data.detail
                    .map(item => {

                        if (typeof item === "string") {
                            return item;
                        }

                        return (
                            item?.msg ||
                            item?.message ||
                            JSON.stringify(item)
                        );
                    })
                    .join(", ");

        } else if (data?.detail) {

            errorMessage =
                typeof data.detail === "object"
                    ? (
                        data.detail.message ||
                        data.detail.msg ||
                        JSON.stringify(data.detail)
                    )
                    : String(data.detail);
        }

        throw new Error(errorMessage);
    }

    return data;
}


/* =========================================================
   LOAD DATA
========================================================= */

async function loadData() {

    console.log(
        "Loading data from:",
        API_BASE_URL
    );

    try {

        appData.customers =
            (await api("/customers"))
                .map(normalizeCustomer);

    } catch (error) {

        console.error(
            "Customers failed:",
            error
        );

        appData.customers = [];
    }


    try {

        appData.vehicles =
            (await api("/vehicles"))
                .map(normalizeVehicle);

    } catch (error) {

        console.error(
            "Vehicles failed:",
            error
        );

        appData.vehicles = [];
    }


    try {

        appData.rentals =
            (await api("/rentals"))
                .map(normalizeRental);

    } catch (error) {

        console.error(
            "Rentals failed:",
            error
        );

        appData.rentals = [];
    }


    try {

        appData.payments =
            (await api("/payments"))
                .map(normalizePayment);

    } catch (error) {

        console.error(
            "Payments failed:",
            error
        );

        appData.payments = [];
    }


    try {

        appData.transactions =
            (await api("/transactions"))
                .map(normalizeTransaction);

    } catch (error) {

        console.error(
            "Transactions failed:",
            error
        );

        appData.transactions = [];
    }


    try {

        appData.pendingPayments =
            (await api("/pending-payments"))
                .map(normalizePendingPayment);

    } catch (error) {

        console.error(
            "Pending payments failed:",
            error
        );

        appData.pendingPayments = [];
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


function normalizePendingPayment(row) {

    return {

        payment_id: String(
            row.payment_id ??
            ""
        ),

        rental_id: String(
            row.rental_id ??
            ""
        ),

        customer_name:
            row.customer_name ??
            "",

        total_amount:
            Number(
                row.total_amount ??
                0
            ),

        amount_paid:
            Number(
                row.amount_paid ??
                0
            ),

        balance:
            Number(
                row.balance_due ??
                0
            ),

        status:
            String(
                row.payment_status ??
                "Pending"
            ).toLowerCase()
    };
}


/* =========================================================
   RENTAL STATUS
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


/* =========================================================
   DERIVED DATA
========================================================= */

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
                            .dataset
                            .section;

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
        .querySelectorAll(".nav-item")
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
        record?.id ?? null;


    const form =
        modal.querySelector("form");

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


function closeModal(
    modalId
) {

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
        () =>
            openModal(
                "customerModal",
                "customer"
            )
    );


    bind(
        "addVehicleBtn",
        () =>
            openModal(
                "vehicleModal",
                "vehicle"
            )
    );


    bind(
        "addRentalBtn",
        () =>
            openModal(
                "rentalModal",
                "rental"
            )
    );


    bind(
        "addPaymentBtn",
        () =>
            openModal(
                "paymentModal",
                "payment"
            )
    );


    bind(
        "quickAddCustomer",
        () =>
            openModal(
                "customerModal",
                "customer"
            )
    );


    bind(
        "quickAddVehicle",
        () =>
            openModal(
                "vehicleModal",
                "vehicle"
            )
    );


    bind(
        "quickCreateRental",
        () =>
            openModal(
                "rentalModal",
                "rental"
            )
    );


    bind(
        "quickRecordPayment",
        () =>
            openModal(
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
        value("customerName").trim();

    const phone =
        value("customerPhone").trim();

    const email =
        value("customerEmail").trim();


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
            error.message ||
            "Unable to save customer.",
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
        value("vehicleModel").trim();

    const type =
        value("vehicleType").trim();

    const rate =
        Number(
            value("ratePerDay")
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
            error.message ||
            "Unable to save vehicle.",
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
        value("rentalCustomer");

    const vehicleId =
        value("rentalVehicle");

    const startDate =
        value("rentalDate");

    const endDate =
        value("expectedReturnDate");


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


    if (endDate < startDate) {

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
        otherActiveRental &&
        (
            !editingId ||
            otherActiveRental.id !==
            String(editingId)
        )
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
            endDate
    };


    if (editingId) {

        const existingRental =
            appData.rentals.find(
                rental =>
                    rental.id ===
                    String(editingId)
            );

        data.actual_return_date =
            existingRental?.actual_return_date ||
            null;
    }


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

        console.error(
            "Rental save failed:",
            error
        );

        showToast(
            error.message ||
            "Unable to save rental.",
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
        value("paymentRental");

    const amount =
        Number(
            value("paymentAmount")
        );

    let method =
        value("paymentMethod");


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
                Number(payment.id);

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
            error.message ||
            "Unable to record payment.",
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
            `<option value="">Select customer</option>`;


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
            `<option value="">Select available vehicle</option>`;


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
                            String(editingId)
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
        `<option value="">Select rental</option>`;


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

    renderDashboardRentals();

    renderFleetStatus();

    renderPendingPaymentsWidget();
}


/* =========================================================
   DASHBOARD — PENDING PAYMENTS
========================================================= */

function renderPendingPaymentsWidget() {

    const container =
        document.getElementById(
            "pendingPaymentsWidget"
        );

    if (!container) {
        return;
    }

    const rows =
        appData.pendingPayments;

    if (!rows.length) {

        container.innerHTML = `
            <div class="table-empty" style="padding: 30px;">
                No pending payments
            </div>
        `;

        return;
    }

    const totalOutstanding =
        rows.reduce(
            (total, row) =>
                total + row.balance,
            0
        );

    const summaryRow = `
        <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 11px 18px;
            border-bottom: 1px solid #f0ebe5;
            background: rgba(217, 90, 79, .05);
        ">
            <strong style="font-size: 9px; color: #5c6470;">
                ${rows.length} rental(s) with a balance due
            </strong>

            <strong style="font-size: 11px; color: #b42318;">
                ₹${totalOutstanding.toLocaleString(
                    "en-IN",
                    { minimumFractionDigits: 2 }
                )}
            </strong>
        </div>
    `;

    const listRows =
        rows
            .slice(0, 5)
            .map(
                row => `

                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 12px;
                        padding: 11px 18px;
                        border-bottom: 1px solid #f0ebe5;
                    ">

                        <div>

                            <strong style="
                                display: block;
                                font-size: 10px;
                                color: #303949;
                            ">
                                ${escapeHTML(
                                    row.customer_name ||
                                    `Rental #${row.rental_id}`
                                )}
                            </strong>

                            <small style="
                                display: block;
                                font-size: 8px;
                                color: #a1a2a4;
                                margin-top: 1px;
                            ">
                                Rental #${escapeHTML(row.rental_id)}
                            </small>

                        </div>

                        <div style="
                            display: flex;
                            align-items: center;
                            gap: 6px;
                        ">

                            ${badge(row.status)}

                            <span class="badge badge-danger">
                                ₹${row.balance.toLocaleString(
                                    "en-IN",
                                    { minimumFractionDigits: 2 }
                                )}
                            </span>

                        </div>

                    </div>

                `
            )
            .join("");

    container.innerHTML =
        summaryRow +
        listRows;
}


/* =========================================================
   DASHBOARD — RECENT RENTALS
========================================================= */

function renderDashboardRentals() {

    const tbody =
        document.getElementById(
            "dashboardRentalsBody"
        );

    if (!tbody) {
        return;
    }

    const rows =
        [...appData.rentals]
            .sort(
                (a, b) =>
                    Number(b.id) -
                    Number(a.id)
            )
            .slice(0, 5);

    if (!rows.length) {

        emptyTable(
            tbody,
            5,
            "No rentals yet"
        );

        return;
    }

    tbody.innerHTML =
        rows
            .map(
                rental => `

                    <tr>

                        <td>
                            <strong>
                                #${escapeHTML(rental.id)}
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
                            )} – ${formatDate(
                                rental.expected_return_date
                            )}
                        </td>

                        <td>
                            ${badge(
                                rental.status
                            )}
                        </td>

                    </tr>

                `
            )
            .join("");
}


/* =========================================================
   DASHBOARD — FLEET STATUS
========================================================= */

function renderFleetStatus() {

    const container =
        document.getElementById(
            "fleetStatus"
        );

    if (!container) {
        return;
    }

    if (!appData.vehicles.length) {

        container.innerHTML = `
            <div class="table-empty" style="padding: 30px;">
                No vehicles found
            </div>
        `;

        return;
    }

    container.innerHTML =
        appData.vehicles
            .map(
                vehicle => `

                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 12px;
                        padding: 11px 18px;
                        border-bottom: 1px solid #f0ebe5;
                    ">

                        <div>

                            <strong style="
                                display: block;
                                font-size: 10px;
                                color: #303949;
                            ">
                                ${escapeHTML(vehicle.model)}
                            </strong>

                            <small style="
                                display: block;
                                font-size: 8px;
                                color: #a1a2a4;
                                margin-top: 1px;
                            ">
                                ${escapeHTML(
                                    capitalize(vehicle.type)
                                )} · ₹${Number(
                                    vehicle.daily_rate
                                ).toLocaleString("en-IN")}/day
                            </small>

                        </div>

                        ${badge(
                            vehicle.availability_status
                        )}

                    </div>

                `
            )
            .join("");
}


/* =========================================================
   CUSTOMERS TABLE
========================================================= */

function renderCustomers() {

    const tbody =
        document.getElementById(
            "customersTableBody"
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
            6,
            "No customers found"
        );

        return;
    }


    tbody.innerHTML =
        rows
            .map(
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
                                customer.email
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                customer.phone
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                customer.license_number ||
                                "—"
                            )}
                        </td>

                        <td>

                            <div class="action-buttons">

                                <button
                                    class="action-button"
                                    onclick="editCustomer('${safeAttr(customer.id)}')">

                                    <i class="fa-solid fa-pen"></i>

                                </button>

                                <button
                                    class="action-button danger-action"
                                    onclick="deleteCustomer('${safeAttr(customer.id)}')">

                                    <i class="fa-solid fa-trash"></i>

                                </button>

                            </div>

                        </td>

                    </tr>

                `
            )
            .join("");
}


/* =========================================================
   VEHICLES TABLE
========================================================= */

function renderVehicles() {

    const tbody =
        document.getElementById(
            "vehiclesTableBody"
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
            8,
            "No vehicles found"
        );

        return;
    }


    tbody.innerHTML =
        rows
            .map(
                vehicle => `

                    <tr>

                        <td>
                            #${escapeHTML(
                                vehicle.id
                            )}
                        </td>

                        <td>
                            ${escapeHTML(
                                vehicle.model
                            )}
                        </td>

                        <td>—</td>

                        <td>
                            ${escapeHTML(
                                capitalize(
                                    vehicle.type
                                )
                            )}
                        </td>

                        <td>—</td>

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
                                    onclick="editVehicle('${safeAttr(vehicle.id)}')">

                                    <i class="fa-solid fa-pen"></i>

                                </button>

                                <button
                                    class="action-button danger-action"
                                    onclick="deleteVehicle('${safeAttr(vehicle.id)}')">

                                    <i class="fa-solid fa-trash"></i>

                                </button>

                            </div>

                        </td>

                    </tr>

                `
            )
            .join("");
}


/* =========================================================
   RENTALS TABLE
========================================================= */

function renderRentals() {

    const tbody =
        document.getElementById(
            "rentalsTableBody"
        );


    if (!tbody) {

        console.error(
            "Rental table body not found. Expected #rentalsTableBody"
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


    if (!rows.length) {

        emptyTable(
            tbody,
            8,
            "No rentals found"
        );

        return;
    }


    tbody.innerHTML =
        rows
            .map(
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
                            ${formatDate(
                                rental.actual_return_date
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
                                    title="Edit">

                                    <i class="fa-solid fa-pen"></i>

                                </button>

                                <button
                                    class="action-button danger-action"
                                    onclick="deleteRental('${safeAttr(rental.id)}')"
                                    title="Delete">

                                    <i class="fa-solid fa-trash"></i>

                                </button>

                            </div>

                        </td>

                    </tr>

                `
            )
            .join("");
}


/* =========================================================
   PAYMENTS TABLE
========================================================= */

function renderPayments() {

    const tbody =
        document.getElementById(
            "paymentsTableBody"
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
            8,
            "No payments found"
        );

        return;
    }


    tbody.innerHTML =
        rows
            .map(
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

                                ${escapeHTML(
                                    getCustomerName(
                                        appData.rentals.find(
                                            r =>
                                                r.id ===
                                                payment.rental_id
                                        )?.customer_id
                                    )
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
                                        onclick="editPayment('${safeAttr(payment.id)}')">

                                        <i class="fa-solid fa-pen"></i>

                                    </button>

                                    <button
                                        class="action-button danger-action"
                                        onclick="deletePayment('${safeAttr(payment.id)}')">

                                        <i class="fa-solid fa-trash"></i>

                                    </button>

                                </div>

                            </td>

                        </tr>

                    `;
                }
            )
            .join("");
}


/* =========================================================
   TRANSACTIONS TABLE
========================================================= */

function renderTransactions() {

    const tbody =
        document.getElementById(
            "transactionsTableBody"
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
            7,
            "No transactions found"
        );

        return;
    }


    tbody.innerHTML =
        rows
            .map(
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

                        <td>—</td>

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
                            ${escapeHTML(
                                transaction.payment_method ||
                                "—"
                            )}
                        </td>

                        <td>
                            ${formatDate(
                                transaction.date
                            )}
                        </td>

                        <td>
                            ${badge(
                                "success"
                            )}
                        </td>

                    </tr>

                `
            )
            .join("");
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
   DELETE
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
            error.message ||
            "Unable to delete customer.",
            "error"
        );
    }
}


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
            error.message ||
            "Unable to delete vehicle.",
            "error"
        );
    }
}


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
            error.message ||
            "Unable to delete rental.",
            "error"
        );
    }
}


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
            error.message ||
            "Unable to delete payment.",
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
            (
                total,
                transaction
            ) =>
                total +
                Number(
                    transaction.amount ||
                    0
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
        `₹${totalRevenue.toLocaleString("en-IN")}`
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
        document.getElementById(id)
            ?.value ||
        ""
    );
}


function setValue(
    id,
    newValue
) {

    const element =
        document.getElementById(id);

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
        document.getElementById(id);

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
                String(customerId)
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
                String(vehicleId)
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
        ).padStart(
            2,
            "0"
        ),

        String(
            date.getDate()
        ).padStart(
            2,
            "0"
        )

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
        String(text || "");


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
        String(method || "")
            .toLowerCase();


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
                class="table-empty">

                ${escapeHTML(
                    message
                )}

            </td>

        </tr>

    `;
}


function safeAttr(value) {

    return escapeHTML(
        String(
            value ?? ""
        )
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


    if (
        typeof message ===
        "object"
    ) {

        message =
            message?.message ||
            message?.detail ||
            JSON.stringify(message);
    }


    toast.textContent =
        String(
            message ||
            ""
        );


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
            new Date().toLocaleDateString(
                "en-IN",
                {
                    weekday: "long",
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
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
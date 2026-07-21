window.addEventListener(
    "load",
    loadTrips
);

async function loadTrips(){

    const tx =
        db.transaction(
            "trips",
            "readonly"
        );

    const store =
        tx.objectStore(
            "trips"
        );

    const request =
        store.getAll();

    request.onsuccess =
        () => {

            const trips =
                request.result;

            renderTrips(
                trips
            );
        };
}

function renderTrips(trips){

    const container =
        document.getElementById(
            "tripList"
        );

    if(trips.length === 0){

        container.innerHTML =
            "<p>No Trips Yet</p>";

        return;
    }

    container.innerHTML = "";

    trips.reverse();

    trips.forEach(trip => {

        container.innerHTML += `

        <div class="product-card">

            <strong>

                ${trip.tripId}

            </strong>

            <br>

            Date:

            ${new Date(
                trip.date
            ).toLocaleString()}

            <br>

            Total:

            $${trip.total.toFixed(2)}

            <br><br>

            <button

            onclick="viewTrip(
                '${trip.tripId}'
            )">

            View Items

            </button>

        </div>

        `;
    });
}

function viewTrip(tripId){

    localStorage.setItem(
        "selectedTrip",
        tripId
    );

    location.href =
        "trip-details.html";
}
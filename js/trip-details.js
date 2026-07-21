window.addEventListener(
    "load",
    loadTripDetails
);

async function loadTripDetails(){

    const tripId =

        localStorage.getItem(
            "selectedTrip"
        );

    if(!tripId){

        alert(
            "No Trip Selected"
        );

        location.href =
            "trip-history.html";

        return;
    }

    loadSummary(tripId);

    loadItems(tripId);
}

async function loadSummary(tripId){

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
        store.get(tripId);

    request.onsuccess = () => {

        const trip =
            request.result;

        document.getElementById(
            "tripSummary"
        ).innerHTML = `

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

            </div>

        `;
    };
}

async function loadItems(tripId){

    const items =

        await smartCart
        .getTripItems(
            tripId
        );

    const container =

        document.getElementById(
            "tripItems"
        );

    if(items.length === 0){

        container.innerHTML =
            "No Items";

        return;
    }

    container.innerHTML =

        items.map(item => `

            <div class="product-card">

                <strong>

                    ${item.name}

                </strong>

                <br>

                Qty:
                ${item.quantity}

                <br>

                Unit:
                $${item.unitPrice}

                <br>

                Total:
                $${item.total}

            </div>

        `).join("");
}
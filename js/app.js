// ===============================
// SMART CART DATABASE ENGINE
// Version 1.0
// ===============================

const DB_NAME = "SmartCartDB";
const DB_VERSION = 3;

let db;

// ===============================
// REAL-TIME TAB SYNCHRONIZATION
// ===============================

const cartChannel =
new BroadcastChannel("smartcart");

function broadcastCartUpdate(){

    cartChannel.postMessage({

        type:"cart-updated",

        time:Date.now()

    });

}

let dbReadyResolve;

const dbReady =

new Promise(resolve => {

    dbReadyResolve = resolve;

});


// ===============================
// OPEN DATABASE
// ===============================

const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onerror = (event) => {
    console.error("Database Error:", event.target.error);
};

request.onsuccess = (event) => {
    db = event.target.result;
    dbReadyResolve();

    console.log("Database Connected");

    seedSampleData();
    loadDashboard();
};

request.onupgradeneeded = (event) => {

    db = event.target.result;

    // Products Store
    if (!db.objectStoreNames.contains("products")) {

        const productsStore =
            db.createObjectStore("products", {
                keyPath: "barcode"
            });

        productsStore.createIndex(
            "name",
            "name",
            { unique: false }
        );
    }

    // Trips Store
    if (!db.objectStoreNames.contains("trips")) {

        db.createObjectStore("trips", {
            keyPath: "tripId"
        });
    }

    // Trip Items Store
    if (!db.objectStoreNames.contains("tripItems")) {

        db.createObjectStore("tripItems", {
            keyPath: "id",
            autoIncrement: true
        });
    }

    if(
    !db.objectStoreNames.contains(
        "budget"
    )
){

    db.createObjectStore(
        "budget",
        {
            keyPath: "id"
        }
    );

}



// Price History Store
if (!db.objectStoreNames.contains("priceHistory")) {

    db.createObjectStore(
        "priceHistory",
        {
            keyPath: "id",
            autoIncrement: true
        }
    );
}

if (!db.objectStoreNames.contains("cart")) {

    db.createObjectStore(
        "cart",
        {
            keyPath: "id",
            autoIncrement: true
        }
    );
}
    }

    console.log("Database Created");

    

// ===============================
// SAMPLE DATA
// ===============================

function seedSampleData() {

    const tx = db.transaction("products", "readonly");
    const store = tx.objectStore("products");

    const countRequest = store.count();

    countRequest.onsuccess = () => {

        if (countRequest.result > 0) {
            return;
        }

        console.log("Adding sample data");

        const tx2 =
            db.transaction(
                ["products", "trips"],
                "readwrite"
            );

        const products =
            tx2.objectStore("products");

        const trips =
            tx2.objectStore("trips");

        products.add({
            barcode: "111111",
            name: "Milk",
            category: "Dairy",
            lastPrice: 4.50
        });

        products.add({
            barcode: "222222",
            name: "Eggs",
            category: "Dairy",
            lastPrice: 3.80
        });

        products.add({
            barcode: "333333",
            name: "Bread",
            category: "Bakery",
            lastPrice: 2.20
        });

        trips.add({
            tripId: "trip001",
            date: "2026-06-01",
            total: 212
        });

        trips.add({
            tripId: "trip002",
            date: "2026-05-15",
            total: 476
        });

        trips.add({
            tripId: "trip003",
            date: "2026-04-22",
            total: 520
        });

    };
}

// ===============================
// LOAD DASHBOARD
// ===============================

function loadDashboard() {

    loadProductCount();
    loadRecentTrips();
}

// ===============================
// PRODUCT COUNT
// ===============================

function loadProductCount() {

    const tx =
        db.transaction("products", "readonly");

    const store =
        tx.objectStore("products");

    const countRequest =
        store.count();

    countRequest.onsuccess = () => {

        console.log(
            "Products:",
            countRequest.result
        );
    };
}

// ===============================
// RECENT TRIPS
// ===============================

function loadRecentTrips() {

    const tx =
        db.transaction("trips", "readonly");

    const store =
        tx.objectStore("trips");

    const request =
        store.getAll();

    request.onsuccess = () => {

        const trips =
            request.result;

        console.log("Trips:", trips);

        const listItems =
            document.querySelectorAll(
                ".list-item"
            );

        trips.forEach((trip, index) => {

            if (!listItems[index]) return;

            listItems[index].innerHTML = `
                <span>${trip.date}</span>
                <span>$${trip.total}</span>
            `;
        });
    };
}

// ===============================
// ADD PRODUCT
// ===============================

function addProduct(product){

    return new Promise((resolve,reject)=>{

        const tx =
            db.transaction(
                ["products","priceHistory"],
                "readwrite"
            );

        const productsStore =
            tx.objectStore(
                "products"
            );

        const historyStore =
            tx.objectStore(
                "priceHistory"
            );

        const request =
            productsStore.get(
                product.barcode
            );

        request.onsuccess = ()=>{

            const existing =
                request.result;

            if(existing){

                if(
                    existing.lastPrice !=
                    product.lastPrice
                ){

                    const change =

                        (
                            (
                                product.lastPrice -
                                existing.lastPrice
                            )

                            /

                            existing.lastPrice

                        ) * 100;

                    historyStore.add({

                        barcode:
                            product.barcode,

                        name:
                            product.name,

                        oldPrice:
                            existing.lastPrice,

                        newPrice:
                            product.lastPrice,

                        change:
                            change,

                        date:
                            new Date()
                            .toISOString()

                    });

                    console.log(
                        "Price Change Saved"
                    );
                }

                productsStore.put(
                    product
                );
            }

            else{

                productsStore.add(
                    product
                );
            }

            resolve(product);
        };

        request.onerror =
            reject;
    });
}








// ===============================
// FIND PRODUCT
// ===============================

function findProduct(barcode) {

    return new Promise((resolve, reject) => {

        const tx =
            db.transaction(
                "products",
                "readonly"
            );

        const store =
            tx.objectStore("products");

        const request =
            store.get(barcode);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(null);
        };
    });
}

// ===============================
// SAVE TRIP
// ===============================

function saveTrip(trip) {

    const tx =
        db.transaction(
            "trips",
            "readwrite"
        );

    const store =
        tx.objectStore("trips");

    store.put(trip);
}

// ===============================
// SAVE PRICE HISTORY
// ===============================

function savePriceHistory(data) {

    const tx =
        db.transaction(
            "priceHistory",
            "readwrite"
        );

    const store =
        tx.objectStore(
            "priceHistory"
        );

    store.add(data);
}

async function checkoutCart(){

    const cartItems =
        await getCartItems();

    if(cartItems.length === 0){

        alert("Cart Empty");
        return;
    }

    const tripId =
        "trip" + Date.now();

    let total = 0;

    cartItems.forEach(item => {

        total +=
            item.price *
            item.quantity;

    });

    const tx =
        db.transaction(
            ["trips","tripItems"],
            "readwrite"
        );

    const tripsStore =
        tx.objectStore(
            "trips"
        );

    const tripItemsStore =
        tx.objectStore(
            "tripItems"
        );

    tripsStore.add({

        tripId,
        date:
            new Date()
            .toISOString(),

        total
    });

    cartItems.forEach(item => {

        tripItemsStore.add({

            tripId,

            barcode:
                item.barcode,

            name:
                item.name,

            quantity:
                item.quantity,

            unitPrice:
                item.price,

            total:
                item.price *
                item.quantity
        });

    });

    tx.oncomplete = () => {

        clearCart();

        alert(
            "Trip Saved\nTotal: $" +
            total.toFixed(2)
        );

        location.reload();
    };
}








// ===============================
// TEST FUNCTIONS
// ===============================


window.smartCart = {

    dbReady,

    addProduct,
    findProduct,


    getPriceInsights,
    getMonthlySpending,


    checkoutCart,
    

    getTripItems,
    
    saveTrip,
    savePriceHistory,

    addToCart,
    getCartItems,

    increaseCartQuantity,
    decreaseCartQuantity,

    getPriceHistory,
    getInflationStats,
    getCategorySpending,
    getPriceAlerts,

    deleteCartItem,
    clearCart
};



console.log(
    "Smart Cart Ready"
);

setTimeout(() => {

    addProduct({
        barcode: "999999",
        name: "Milo",
        category: "Beverages",
        lastPrice: 8.95
    });

    console.log("Milo Added");

}, 3000);



function addToCart(barcode){

    return new Promise(resolve => {

        findProduct(barcode)

        .then(product => {

            const tx =
                db.transaction(
                    "cart",
                    "readwrite"
                );

            const store =
                tx.objectStore(
                    "cart"
                );

            const request =
                store.getAll();

            request.onsuccess = () => {

                const existing =
                    request.result.find(
                        item =>
                        item.barcode === barcode
                    );

                if(existing){

                    existing.quantity += 1;

                    store.put(existing);
                    broadcastCartUpdate();
                    resolve();

                } else {

                    store.add({
                        barcode:product.barcode,
                        name:product.name,
                        price:product.lastPrice,
                        quantity:1

});

broadcastCartUpdate();

resolve();
                }
            };
        });
    });
}









function getCartItems(){

    return new Promise(
        resolve => {

        const tx =
            db.transaction(
                "cart",
                "readonly"
            );

        const store =
            tx.objectStore(
                "cart"
            );

        const request =
            store.getAll();

        request.onsuccess =
            () =>
            resolve(
                request.result
            );

    });
}


function deleteCartItem(id){

    const tx =
        db.transaction(
            "cart",
            "readwrite"
        );

    const store =
        tx.objectStore(
            "cart"
        );

    store.delete(id);

broadcastCartUpdate();

}

function increaseCartQuantity(id){

    const tx =
        db.transaction(
            "cart",
            "readwrite"
        );

    const store =
        tx.objectStore("cart");

    const request =
        store.get(id);

    request.onsuccess = () => {

        const item =
            request.result;

        item.quantity += 1;

        store.put(item);

broadcastCartUpdate();

    };
}

function decreaseCartQuantity(id){

    const tx =
        db.transaction(
            "cart",
            "readwrite"
        );

    const store =
        tx.objectStore("cart");

    const request =
        store.get(id);

    request.onsuccess = () => {

        const item =
            request.result;

        item.quantity -= 1;

        if(item.quantity <= 0){

            store.delete(id);

broadcastCartUpdate();

        }else{

            store.put(item);

broadcastCartUpdate();

        }
    };
}


function clearCart(){

    const tx =
        db.transaction(
            "cart",
            "readwrite"
        );

    const store =
        tx.objectStore(
            "cart"
        );

    store.clear();

broadcastCartUpdate();

}



function getPriceHistory(){






    return new Promise((resolve)=>{

        const tx =
            db.transaction(
                "priceHistory",
                "readonly"
            );

        const store =
            tx.objectStore(
                "priceHistory"
            );

        const request =
            store.getAll();

        request.onsuccess = ()=>{

            resolve(
                request.result
            );
        };
    });
}

function getInflationStats(){

    return new Promise(async resolve => {

        const history =

            await getPriceHistory();

        if(history.length === 0){

            resolve({

                overall:0,
                highestIncrease:null,
                highestDecrease:null,
                totalChanges:0

            });

            return;
        }

        let total = 0;

        let highestIncrease =
            history[0];

        let highestDecrease =
            history[0];

        history.forEach(item => {

            total += item.change;

            if(
                item.change >
                highestIncrease.change
            ){

                highestIncrease =
                    item;
            }

            if(
                item.change <
                highestDecrease.change
            ){

                highestDecrease =
                    item;
            }

        });

        resolve({

            overall:

                total /
                history.length,

            highestIncrease,

            highestDecrease,

            totalChanges:

                history.length

        });

    });

}


function getCategorySpending(){

    return new Promise(resolve => {

        const tx =
            db.transaction(
                "tripItems",
                "readonly"
            );

        const store =
            tx.objectStore(
                "tripItems"
            );

        const request =
            store.getAll();

        request.onsuccess =
            async () => {

                const items =
                    request.result;

                const results = {};

                for(const item of items){

                    const product =
                        await findProduct(
                            item.barcode
                        );

                    const category =
                        product?.category ||
                        "Unknown";

                    if(!results[category]){

                        results[category] = 0;
                    }

                    results[category] +=
                        item.total;
                }

                resolve(results);
            };
    });
}



smartCart.setBudget =
async function(amount){

    const tx =
        db.transaction(
            "budget",
            "readwrite"
        );

    tx.objectStore(
        "budget"
    ).put({

        id: 1,

        amount:
            Number(amount)

    });

};

smartCart.getBudget =
async function(){

    return new Promise(
        resolve => {

            const tx =
                db.transaction(
                    "budget",
                    "readonly"
                );

            const request =
                tx.objectStore(
                    "budget"
                ).get(1);

            request.onsuccess =
                () => {

                resolve(
                    request.result
                );

            };

        }
    );

};


smartCart.deleteBudget =
async function(){

    const tx =
        db.transaction(
            "budget",
            "readwrite"
        );

    tx.objectStore(
        "budget"
    ).delete(1);

};




smartCart.updateProductPrice =
async function(barcode,newPrice){

    const product =
        await smartCart.findProduct(
            barcode
        );

    if(!product) return;

    const oldPrice =
        product.lastPrice;

    if(oldPrice !== newPrice){

        smartCart.savePriceHistory({

    barcode,
    name: product.name,
    oldPrice,
    newPrice,

    change:
    (
        (
            newPrice - oldPrice
        )
        /
        oldPrice
    ) * 100,

    date:
        new Date()
        .toISOString()
});
    }

    product.lastPrice =
        newPrice;

    const tx =
        db.transaction(
            "products",
            "readwrite"
        );

    tx.objectStore(
        "products"
    ).put(product);
};

function getTripItems(tripId){

    return new Promise(resolve => {

        const tx =
            db.transaction(
                "tripItems",
                "readonly"
            );

        const store =
            tx.objectStore(
                "tripItems"
            );

        const request =
            store.getAll();

        request.onsuccess = () => {

            const items =

                request.result.filter(
                    item =>
                    item.tripId === tripId
                );

            resolve(items);
        };
    });
}


function getMonthlySpending(){

    return new Promise(resolve => {

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

        request.onsuccess = () => {

            const trips =
                request.result;

            const monthly = {};

            trips.forEach(trip => {

                const date =
                    new Date(trip.date);

                const key =
                    date.getFullYear() +
                    "-" +
                    String(
                        date.getMonth() + 1
                    ).padStart(2,"0");

                if(!monthly[key]){

                    monthly[key] = 0;
                }

                monthly[key] += trip.total;
            });

            resolve(monthly);
        };
    });
}

function getPriceAlerts(){

    return new Promise(async resolve => {

        const history =
            await getPriceHistory();

        const alerts = [];

        history.forEach(item => {

            if(item.change >= 25){

                alerts.push({
                    type: "severe",
                    message:
                        `${item.name} increased ${item.change.toFixed(1)}%`
                });

            }

            else if(item.change > 0){

                alerts.push({
                    type: "increase",
                    message:
                        `${item.name} increased ${item.change.toFixed(1)}%`
                });

            }

            else if(item.change < 0){

                alerts.push({
                    type: "decrease",
                    message:
                        `${item.name} decreased ${Math.abs(item.change).toFixed(1)}%`
                });

            }

        });

        resolve(alerts);

    });

}






function getPriceInsights(){

    return new Promise(async resolve => {

        const history =
            await getPriceHistory();

        if(history.length === 0){

            resolve({

                biggestIncrease:null,
                biggestDecrease:null,
                totalChanges:0

            });

            return;
        }

        let biggestIncrease =
            history[0];

        let biggestDecrease =
            history[0];

        history.forEach(item => {

            if(
                item.change >
                biggestIncrease.change
            ){

                biggestIncrease =
                    item;
            }

            if(
                item.change <
                biggestDecrease.change
            ){

                biggestDecrease =
                    item;
            }

        });

        resolve({

            biggestIncrease,
            biggestDecrease,

            totalChanges:
                history.length

        });

    });

}


smartCart.getInflationLeaderboard =

async function(){

    const history =

        await smartCart
        .getPriceHistory();

    return history

        .sort(

            (a,b) =>

                Math.abs(b.change) -

                Math.abs(a.change)

        )

        .map(item => ({

            name:

                item.name,

            change:

                item.change

        }));

};

smartCart.getRecommendations =

async function(){

    const spending =
        await smartCart
        .getCategorySpending();

    const budget =
        await smartCart
        .getBudget();

    const monthly =
        await smartCart
        .getMonthlySpending();

    const recommendations = [];

    const categories =
        Object.entries(spending);

    if(categories.length > 0){

        const topCategory =

            categories.sort(
                (a,b)=>
                b[1]-a[1]
            )[0];

        recommendations.push({

            title:
                "Top Category",

            message:
                `${topCategory[0]} - $${topCategory[1].toFixed(2)}`

        });

    }

    if(budget){

        const latestMonth =

            Object.keys(monthly)
            .sort()
            .pop();

        const spent =

            latestMonth

            ? monthly[latestMonth]

            : 0;

        const percent =

            (
                spent /
                budget.amount
            ) * 100;

        recommendations.push({

            title:
                "Budget Usage",

            message:
                `${percent.toFixed(1)}% used`

        });

    }

    return recommendations;

};

async function updateCartBadge(){

    const items =
        await getCartItems();

    let count = 0;

    items.forEach(item => {

        count += item.quantity;

    });

    const badge =

        document.getElementById(
            "cartBadge"
        );

    if(badge){

        badge.textContent =

            `🛒 Cart (${count})`;
    }
}

dbReady.then(() => {

    updateCartBadge();

    updateHomeDashboard();

});

cartChannel.onmessage = () => {

    updateCartBadge();

    updateHomeDashboard();

    if(typeof loadCart === "function"){

        loadCart();

    }

};



async function updateHomeDashboard(){

    const items = await getCartItems();

    let totalItems = 0;
    let totalPrice = 0;

    items.forEach(item => {

        totalItems += item.quantity;

        totalPrice +=
            item.price *
            item.quantity;

    });

    const itemsBox =
        document.getElementById(
            "dashboardItems"
        );

    const totalBox =
        document.getElementById(
            "dashboardTotal"
        );

    if(itemsBox){

        itemsBox.textContent =
            totalItems;

    }

    if(totalBox){

        totalBox.textContent =
            "$" +
            totalPrice.toFixed(2);

    }

}





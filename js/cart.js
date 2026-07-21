window.addEventListener(
    "load",
    loadCart
);

function loadCart(){

    getCartItems()
    .then(items => {

        const container =
            document.getElementById(
                "cartItems"
            );

        const totalElement =
            document.getElementById(
                "cartTotal"
            );

        container.innerHTML = "";



        if(items.length===0){

container.innerHTML=`

<div style="text-align:center;padding:50px;color:#999;">

🛒

<h3>Your cart is empty</h3>

<p>Add products to begin shopping.</p>

</div>

`;

totalElement.textContent="0.00";

return;

}

        let total = 0;

        items.forEach(item => {

            total +=
                item.price *
                item.quantity;

            container.innerHTML += `

<div class="cart-item">

    <div>

        <div class="cart-name">

            ${item.name}

        </div>

        <div>

            Unit:
            $${item.price}

        </div>

        <div>

            Subtotal:

            $${

                (
                    item.price *
                    item.quantity
                ).toFixed(2)

            }

        </div>

    </div>


    



    <div class="cart-controls">

    <button
        class="qty-btn"
        onclick="decreaseItem(${item.id})">

        −

    </button>

    <span class="qty-number">

        ${item.quantity}

    </span>

    <button
        class="qty-btn"
        onclick="increaseItem(${item.id})">

        +

    </button>

</div>

<br>

<button
    class="remove-btn"
    onclick="removeCartItem(${item.id})">

    🗑 Remove

</button>

</div>

`;
        });

        totalElement.textContent =
            total.toFixed(2);

    });
}


function removeCartItem(id){

    const removeButton = document.querySelector(
        `button[onclick="removeCartItem(${id})"]`
    );

    const card = removeButton
        ? removeButton.closest(".cart-item")
        : null;

    if(card){

        card.style.opacity = ".35";
        card.style.transform = "translateX(40px)";
    }

    setTimeout(() => {

        deleteCartItem(id);

        setTimeout(() => {

            loadCart();

            updateCartBadge();

        },100);

    },250);

}





async function checkout(){

    await smartCart.checkoutCart();

}

function increaseItem(id){

    smartCart
    .increaseCartQuantity(id);

    setTimeout(() => {

        loadCart();

        updateCartBadge();

    },150);
}

function decreaseItem(id){

    smartCart
    .decreaseCartQuantity(id);

    setTimeout(() => {

        loadCart();

        updateCartBadge();

    },150);
}

function emptyCart(){

    if(
        !confirm(
            "Clear cart?"
        )
    ) return;

    smartCart.clearCart();

    setTimeout(() => {

        loadCart();

        updateCartBadge();

    },150);
}





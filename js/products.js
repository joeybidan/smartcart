window.addEventListener(
    "load",
    loadProducts
);

async function saveProduct() {

    const barcode =
        document.getElementById("barcode").value;

    const name =
        document.getElementById("productName").value;

    const category =
        document.getElementById("category").value;

    const price =
        parseFloat(
            document.getElementById("price").value
        );

        if(

barcode.trim()==="" ||

name.trim()==="" ||

category.trim()==="" ||

isNaN(price)

){

alert("Please complete all fields.");

return;

}

    const existingProduct =
        await smartCart.findProduct(barcode);

    if (existingProduct) {

        await smartCart.updateProductPrice(
            barcode,
            price
        );

        alert("Product Updated");

    } else {

await addProduct({
    barcode,
    name,
    category,
    lastPrice: price
});

        alert("Product Saved");
    }

    loadProducts();
}







function loadProducts(){

    if(!db) return;

    const tx =
        db.transaction(
            "products",
            "readonly"
        );

    const store =
        tx.objectStore(
            "products"
        );

    const request =
        store.getAll();

    request.onsuccess = () => {

        const products =
            request.result;

        const container =
            document.getElementById(
                "productsList"
            );

        container.innerHTML = "";

        products.forEach(product => {

            container.innerHTML += `
            <div class="product-card">


            


            <h4>

${product.name}

</h4>

<div class="category">

${product.category}

</div>

<div class="price">

$${product.lastPrice.toFixed(2)}

</div>


                <button
                    class="add-cart-btn"
                    onclick="addProductToCart('${product.barcode}')">

                    Add To Cart

                </button>

            </div>
            `;
        });
    };
}

async function addProductToCart(barcode){

await addToCart(barcode);

await updateCartBadge();

await updateHomeDashboard();

    
const product = await smartCart.findProduct(barcode);

const items = await getCartItems();

let total = 0;

items.forEach(item=>{

    total += item.quantity;

});

showToast(

`🛒 ${product.name} added

Cart: ${total} items`

);

}

function showToast(message){

    const toast =
        document.getElementById(
            "toast"
        );

    if(!toast) return;

    toast.textContent =
        message;

    toast.classList.add(
        "show"
    );

    setTimeout(() => {

        toast.classList.remove(
            "show"
        );

    },2000);
}




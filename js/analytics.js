




async function loadInflation(){

    const stats =

        await smartCart
        .getInflationStats();

    const dashboard =

        document.getElementById(
            "inflationDashboard"
        );

    dashboard.innerHTML = `

        <div class="product-card">

            <strong>

                Overall Inflation

            </strong>

            <br>

            ▲
            ${stats.overall.toFixed(1)}%

        </div>

        <div class="product-card">

            <strong>

                Highest Increase

            </strong>

            <br>

            ${

                stats.highestIncrease
                ? stats.highestIncrease.name
                : "N/A"

            }

            <br>

            ▲

            ${

                stats.highestIncrease
                ? stats.highestIncrease.change.toFixed(1)
                : 0

            }%

        </div>

        <div class="product-card">

            <strong>

                Highest Decrease

            </strong>

            <br>

            ${

                stats.highestDecrease
                ? stats.highestDecrease.name
                : "N/A"

            }

            <br>

            ▼

            ${

                stats.highestDecrease
                ? stats.highestDecrease.change.toFixed(1)
                : 0

            }%

        </div>

        <div class="product-card">

            <strong>

                Price Changes Tracked

            </strong>

            <br>

            ${stats.totalChanges}

        </div>

    `;
}


async function loadHistory(){

    const history =

        await smartCart
        .getPriceHistory();

    const container =

        document.getElementById(
            "historyList"
        );

    if(history.length===0){

        container.innerHTML=

            "No price changes yet.";

        return;
    }

    container.innerHTML=

        history.map(item=>{

            const icon =

                item.change > 0

                ? "▲"

                : "▼";

            return `

            <div class="product-card">

                <strong>

                    ${item.name}

                </strong>

                <br>

                Old:
                $${item.oldPrice}

                <br>

                New:
                $${item.newPrice}

                <br>

                ${icon}

                ${item.change.toFixed(1)}%

            </div>

            `;

        }).join("");

}

document
.getElementById(
    "saveBudgetBtn"
)
.addEventListener(
    "click",
    saveBudget
);

document
.getElementById(
    "deleteBudgetBtn"
)
.addEventListener(
    "click",
    deleteBudget
);







async function loadCategorySpending(){

    const data =

        await smartCart
        .getCategorySpending();

    const container =

        document.getElementById(
            "categorySpending"
        );

    const categories =

        Object.entries(data);

    if(categories.length===0){

        container.innerHTML =

            "No spending yet";

        return;
    }

    container.innerHTML =

        categories.map(item => `

            <div class="product-card">

                <strong>

                    ${item[0]}

                </strong>

                <br>

                $${item[1].toFixed(2)}

            </div>

        `).join("");

}



async function loadMonthlySpending(){

    const data =
        await smartCart.getMonthlySpending();

    const container =
        document.getElementById(
            "monthlySpending"
        );

    const months =
        Object.entries(data);

    if(months.length===0){

        container.innerHTML =
            "No trips recorded yet";

        return;

    }

    container.innerHTML =

        months.map(month => `

            <div class="product-card">

                <strong>

                    ${month[0]}

                </strong>

                <br>

                $${month[1].toFixed(2)}

            </div>

        `).join("");

}


async function initializeAnalytics(){

    await smartCart.dbReady;

    await loadBudget();

    await loadMonthlySpending();

    await loadSpendingTrends();

    await loadInflation();

    await loadCategorySpending();

    await loadHistory();

    await loadPriceAlerts();

    await loadPriceInsights();

    await loadRecommendations();

    await loadLeaderboard();

    await loadCharts();

}

initializeAnalytics();



async function loadSpendingTrends(){

    const data =
        await smartCart
        .getMonthlySpending();

    const container =
        document.getElementById(
            "spendingTrends"
        );

    const months =

        Object.entries(data)

        .sort(
            (a,b) =>
            a[0].localeCompare(
                b[0]
            )
        );

    if(months.length < 2){

        container.innerHTML =

            "Need at least 2 months of data";

        return;
    }

    const current =
        months[months.length - 1];

    const previous =
        months[months.length - 2];

    const change =

        (
            (
                current[1] -
                previous[1]
            )

            /

            previous[1]

        ) * 100;

    let highest =
        months[0];

    let lowest =
        months[0];

    months.forEach(month => {

        if(month[1] > highest[1]){

            highest = month;
        }

        if(month[1] < lowest[1]){

            lowest = month;
        }

    });

    container.innerHTML = `

        <div class="product-card">

            <strong>

                Current Month

            </strong>

            <br>

            $${current[1].toFixed(2)}

        </div>

        <div class="product-card">

            <strong>

                Previous Month

            </strong>

            <br>

            $${previous[1].toFixed(2)}

        </div>

        <div class="product-card">

            <strong>

                Change

            </strong>

            <br>

            ${change >= 0 ? "▲" : "▼"}

            ${Math.abs(change).toFixed(1)}%

        </div>

        <div class="product-card">

            <strong>

                Highest Month

            </strong>

            <br>

            ${highest[0]}

            <br>

            $${highest[1].toFixed(2)}

        </div>

        <div class="product-card">

            <strong>

                Lowest Month

            </strong>

            <br>

            ${lowest[0]}

            <br>

            $${lowest[1].toFixed(2)}

        </div>

    `;
}

async function loadBudget(){

    const budget =

        await smartCart.getBudget();

    const spending =

        await smartCart.getMonthlySpending();

    const currentMonth =

        Object.keys(spending)

        .sort()

        .pop();

    const currentSpent =

        currentMonth

        ? spending[currentMonth]

        : 0;

    const container =

        document.getElementById(
            "budgetDashboard"
        );

    if(!budget){

        container.innerHTML =

            "No budget set";

        return;
    }

    const remaining =

        budget.amount -
        currentSpent;

    const usedPercent =

        budget.amount > 0

        ?

        (
            currentSpent /
            budget.amount
        ) * 100

        : 0;

    container.innerHTML = `

        <div class="product-card">

            <strong>

                Budget

            </strong>

            <br>

            $${budget.amount.toFixed(2)}

        </div>

        <div class="product-card">

            <strong>

                Spent

            </strong>

            <br>

            $${currentSpent.toFixed(2)}

        </div>

        <div class="product-card">

            <strong>

                Remaining

            </strong>

            <br>

            $${remaining.toFixed(2)}

        </div>

        <div class="product-card">

            <strong>

                Used

            </strong>

            <br>

            ${usedPercent.toFixed(1)}%

        </div>

    `;

}

async function saveBudget(){

    const amount =

        Number(

            document.getElementById(
                "budgetInput"
            ).value

        );

    if(amount <= 0){

        alert(
            "Enter a valid budget"
        );

        return;
    }

    await smartCart.setBudget(
        amount
    );

    loadBudget();

}


async function deleteBudget(){

    await smartCart.deleteBudget();

    loadBudget();

}

async function loadPriceAlerts(){

    const alerts =
        await smartCart.getPriceAlerts();

    const container =
        document.getElementById(
            "priceAlerts"
        );

    if(alerts.length === 0){

        container.innerHTML =
            "No alerts yet";

        return;
    }

    container.innerHTML =

        alerts.map(alert => `

            <div class="product-card">

                ${alert.message}

            </div>

        `).join("");

}









async function loadPriceInsights(){

    const insights =

        await smartCart
        .getPriceInsights();

    const container =

        document.getElementById(
            "priceInsights"
        );

    if(
        insights.totalChanges === 0
    ){

        container.innerHTML = `

            <div class="product-card">

                No price changes tracked yet

            </div>

        `;

        return;
    }

    container.innerHTML = `

        <div class="product-card">

            <strong>

                Biggest Increase

            </strong>

            <br>

            ${
                insights.biggestIncrease.name
            }

            <br>

            ▲

            ${
                insights.biggestIncrease
                .change
                .toFixed(1)
            }%

        </div>

        <div class="product-card">

            <strong>

                Biggest Decrease

            </strong>

            <br>

            ${
                insights.biggestDecrease.name
            }

            <br>

            ▼

            ${
                insights.biggestDecrease
                .change
                .toFixed(1)
            }%

        </div>

        <div class="product-card">

            <strong>

                Price Changes

            </strong>

            <br>

            ${
                insights.totalChanges
            }

        </div>

    `;

}


async function loadLeaderboard(){

    const data =

        await smartCart
        .getInflationLeaderboard();

    const container =

        document.getElementById(
            "leaderboard"
        );

    if(data.length === 0){

        container.innerHTML =

            "No price changes tracked yet";

        return;
    }

    container.innerHTML =

        data.map(

            (item,index) => `

            <div class="product-card">

                <strong>

                    #${index + 1}

                </strong>

                <br>

                ${item.name}

                <br>

                ${

                    item.change >= 0

                    ? "▲"

                    : "▼"

                }

                ${Math.abs(item.change).toFixed(1)}%

            </div>

        `

        ).join("");

}

async function loadCharts(){

    await loadMonthlyChart();

    await loadCategoryChart();

    await loadInflationChart();

}



async function loadMonthlyChart(){

    const data =
        await smartCart.getMonthlySpending();

    const months =
        Object.keys(data);

    const totals =
        Object.values(data);

    const ctx =
        document
        .getElementById(
            "monthlyChart"
        );

    new Chart(ctx,{

        type:"line",

        data:{

            labels:months,

            datasets:[{

                label:"Monthly Spending",

                data:totals

            }]

        }

    });

}



async function loadCategoryChart(){

    const data =
        await smartCart
        .getCategorySpending();

    const ctx =
        document
        .getElementById(
            "categoryChart"
        );

    new Chart(ctx,{

        type:"bar",

        data:{

            labels:
                Object.keys(data),

            datasets:[{

                label:"Category Spending",

                data:
                    Object.values(data)

            }]

        }

    });

}



async function loadInflationChart(){

    const history =
        await smartCart
        .getPriceHistory();

    const ctx =
        document
        .getElementById(
            "inflationChart"
        );

    new Chart(ctx,{

        type:"line",

        data:{

            labels:
                history.map(
                    item => item.name
                ),

            datasets:[{

                label:"Inflation %",

                data:
                    history.map(
                        item => item.change
                    )

            }]

        }

    });

}

async function loadRecommendations(){

    const data =

        await smartCart
        .getRecommendations();

    const container =

        document.getElementById(
            "recommendations"
        );

    if(data.length === 0){

        container.innerHTML =

            "No recommendations yet";

        return;
    }

    container.innerHTML =

        data.map(item => `

            <div class="product-card">

                <strong>

                    ${item.title}

                </strong>

                <br>

                ${item.message}

            </div>

        `).join("");

}





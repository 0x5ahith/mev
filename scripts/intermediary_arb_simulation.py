# Quick simulation to test how liquidity changes when there are pools at two
# prices and an intermediary pool with low liquidity, that is used to arb
# repeatedly between both prices

from math import sqrt
from typing import List, Tuple


NUM_ITERATIONS = 100


class Pool:
    counter = 0

    def __init__(self, reserve0, reserve1):
        self.reserve0 = reserve0
        self.reserve1 = reserve1
        self.id = Pool.counter
        Pool.counter += 1

    def __str__(self):
        return (
            f"====> Pool {self.id}\n\tReserve 0: {self.reserve0}\n\t"
            f"Reserve 1: {self.reserve1}\n\tPrice: {self.get_price()}\n"
        )

    def get_price(self) -> float:
        return self.reserve1 / self.reserve0

    def swap(self, token_in, amount_in) -> Tuple[int, float]:
        if token_in == 1:
            self.reserve1 += amount_in
            amount_out = self.reserve0 * amount_in / self.reserve1
            self.reserve0 -= amount_out
        else:
            self.reserve0 += amount_in
            amount_out = self.reserve1 * amount_in / self.reserve0
            self.reserve1 -= amount_out

        return int(not token_in), amount_out


def create_pools() -> List[Pool]:
    # initialize 5 pools, with the first at a different price and second at less liquidity
    return [
        Pool(3e6, 5e6),
        Pool(200, 400),
        Pool(2e6, 4e6),
        Pool(2e6, 4e6),
        Pool(2e6, 4e6),
    ]


# Returns token_in and optimal amount
def get_arbitrage_amount(arb_pool: Pool, real_pool: Pool) -> Tuple[int, float]:
    def calculate_optimal_token_in(P_out_in, r_in, r_out):
        return sqrt(r_in * r_out / P_out_in) - r_in

    P_real = real_pool.get_price()
    P_arb = arb_pool.get_price()

    token_in = 1 if P_real > P_arb else 0
    amount_in = (
        calculate_optimal_token_in(1.0 / P_real, arb_pool.reserve1, arb_pool.reserve0)
        if token_in == 1
        else calculate_optimal_token_in(P_real, arb_pool.reserve0, arb_pool.reserve1)
    )

    return token_in, amount_in


def do_arb(arb_pool, real_pool):
    token_in, amount_in = get_arbitrage_amount(arb_pool, real_pool)
    token_out, amount_out = arb_pool.swap(token_in, amount_in)
    token_final, amount_final = real_pool.swap(token_out, amount_out)

    print(
        f"Profit from arb on Pool {arb_pool.id} with Pool {real_pool.id} is "
        f"{amount_final-amount_in} of token {token_final}"
    )


def run_simulation(pools):
    for _ in range(NUM_ITERATIONS):
        do_arb(pools[1], pools[0])
        do_arb(pools[1], pools[2])
        do_arb(pools[1], pools[0])
        do_arb(pools[1], pools[3])
        do_arb(pools[1], pools[0])
        do_arb(pools[1], pools[4])


def main():
    pools = create_pools()

    print("INITIAL STATE")
    for pool in pools:
        print(pool)

    run_simulation(pools)

    print()
    print("FINAL STATE")
    for pool in pools:
        print(pool)


if __name__ == "__main__":
    main()

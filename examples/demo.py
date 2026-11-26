def power(base: float, exponent=2) -> float:
    """TODO: описание функции power.

    Args:
        base (float): TODO.
        exponent (int): TODO. По умолчанию 2.

    Returns:
        float: TODO.

    Raises:
        ValueError: TODO.
    """
    if exponent < 0:
        raise ValueError("отрицательная степень")
    return base ** exponent


def merge(
    first: dict[str, int],
    second: dict[str, int] = {},
    *extra,
    separator=",",
    **options,
):
    result = {**first, **second}
    return result


class Counter:
    def __init__(self, start: int = 0):
        self.value = start

    def count_to(self, limit: int):
        """Считает от текущего значения до limit.

        Args:
            limit (int): Верхняя граница, не включается.
        """
        while self.value < limit:
            yield self.value
            self.value += 1

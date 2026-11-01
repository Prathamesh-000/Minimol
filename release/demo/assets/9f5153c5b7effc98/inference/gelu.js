/** erf via a convergent positive series, not the tanh GELU approximation.
 * erf(x) = 2/sqrt(pi) exp(-x²) x sum_n (2x²)^n/(3*5*...*(2n+1)).
 * For |x| >= 6 the omitted tail is below double precision around 1.
 */
export function erf(x) {
    if (Number.isNaN(x))
        return NaN;
    const absolute = Math.abs(x);
    if (absolute >= 6)
        return Math.sign(x);
    let term = absolute, sum = term;
    for (let n = 1; n < 160; n++) {
        term *= (2 * absolute * absolute) / (2 * n + 1);
        sum += term;
        if (term <= sum * Number.EPSILON)
            break;
    }
    return Math.sign(x) * (2 / Math.sqrt(Math.PI)) * Math.exp(-absolute * absolute) * sum;
}
export function gelu(x) { return Math.fround(0.5 * x * (1 + erf(x / Math.SQRT2))); }
export function geluInPlace(values) {
    for (let i = 0; i < values.length; i++)
        values[i] = gelu(values[i]);
}

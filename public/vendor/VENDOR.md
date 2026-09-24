# Librerías de terceros (solo el navegador)

Excepción a "cero dependencias" decidida en la ronda 17 de `plan2.md`: cuatro librerías de animación, **descargadas una
vez** de `registry.npmjs.org` (sin `npm install`, sin CDN, sin tocar `package.json`). Solo las usa el navegador, y solo a
través de `public/js/ui/fx/anim.js`; el servidor y los tests no las cargan. Si falta alguna, el juego funciona igual, sin
esa animación.

Descargadas el 2026-09-24. La huella del paquete (`sha512`) coincide con el `dist.integrity` que publica npm.
`test/vendor.spec.mjs` comprueba las huellas `sha256` de cada fichero: si alguien cambia uno, el test falla.

| Librería | Versión | Licencia | Paquete (npm) | Integridad del paquete |
|---|---|---|---|---|
| GSAP (con SplitText, Flip, CustomEase, DrawSVGPlugin, MotionPathPlugin) | 3.15.0 | Standard "no charge" license, https://gsap.com/standard-license (la cabecera de cada `.min.js`) | `gsap/-/gsap-3.15.0.tgz` | `sha512-dMW4CWBTUK1AEEDeZc1g4xpPGIrSf9fJF960qbTZmN/QwZIWY5wgliS6JWl9/25fpTGJrMRtSjGtOmPnfjZB+A==` |
| Motion (`dist/motion.js`, global `Motion`) | 13.4.2 | MIT (`LICENSE.md`) | `motion/-/motion-13.4.2.tgz` | `sha512-PlwVlwO7Ibhv2gZMX9ZqE7eGfSmbeU9Yf+mqkvJFdDSyTK7inlKRCry7IpofrcIU8JY7++83614eG7TJ7ORC2w==` |
| tsParticles slim (`tsparticles.slim.bundle.min.js`) | 4.4.0 | MIT (`LICENSE`) | `@tsparticles/slim/-/slim-4.4.0.tgz` | `sha512-/QhPVl11RYTGF9QL2yBLAaoMMSuJSwbp1NqzBsLf4RXqAWsCDs21rg/FvNYS36znBv8ZbU1XG3nbZIEVOMqSHA==` |
| Lenis (`dist/lenis.min.js` y `dist/lenis.css`) | 1.3.26 | MIT (`LICENSE`) | `lenis/-/lenis-1.3.26.tgz` | `sha512-s/xTCZCxTFvHbAN1OzuhNaN5YPJH2ail0XAkctKW1b+RUAG4nUL5UHLXwNko1h8aEeT2jspBXegMgPJd8zcuag==` |

## Huellas sha256 de cada fichero

```
466e426a5c60c21c94b15a30a3dffacac9bb39ce8f4e07d071d7d4bb1be43390 gsap@3.15.0/CustomEase.min.js
beb19529f54c1212f1f5117d027be01afda2f363a4926d32aa979bc11140edc1 gsap@3.15.0/DrawSVGPlugin.min.js
cbe3ca726350f8d230da38a14ce2384e7772e05a45cee6144dd7fe6dde868c2f gsap@3.15.0/Flip.min.js
ace44a07c6c179f5347d9b46a152d468e4c9f272ee0d68bf0354e00d60000693 gsap@3.15.0/MotionPathPlugin.min.js
419f7027a5f086a12cb7988736d8fdd3a6ed2200229661de25b6628ca7ced344 gsap@3.15.0/SplitText.min.js
92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb gsap@3.15.0/gsap.min.js
bba15b1137346a73ed8c35e7f20961a69e0ed842d956a50339240c3e7b08c089 lenis@1.3.26/LICENSE
2f668ae84a668327f246faf8a770383a2bf69196d214290fbc4d5548910606c5 lenis@1.3.26/lenis.css
53195c9797e7ce7bf9d7fa9242b08209e57f46de4c9dac126a6494fa780e3346 lenis@1.3.26/lenis.min.js
1bf0dc3f7727723e5a032ed12164a47cf92c05204cb1a3485f123c24e2833ed1 motion@13.4.2/LICENSE.md
dad54196f828ac5307b480e34f62d6a9b671770a702d19ecc21a045774f12f51 motion@13.4.2/motion.js
c5c18dbc27f490f2ef90e0b574b8c40f534e495d2cb8a6f1c4bb1183a9c381a4 tsparticles-slim@4.4.0/LICENSE
5074f51a355702b6b3a07a13ad9a94b603ce7613fb7a8cae70660de0fbe4d92b tsparticles-slim@4.4.0/tsparticles.slim.bundle.min.js
```

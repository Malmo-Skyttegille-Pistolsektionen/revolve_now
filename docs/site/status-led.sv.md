# Statuslampan (LED)

Statuslampan behöver en egen sida, för den är det enda enheten säger till dig
när ingen har en webbläsare öppen — och på skjutbanan är det normalfallet.

Det finns **två sekvenser**, inte en, och vilken du tittar på är det första
att reda ut: en enhet som känner till ett nätverk, och en enhet som inte gör
det.

## En enhet som känner till ett nätverk { #a-device-that-knows-a-network }

Den vanliga uppstarten, varje gång kortet strömsätts på skjutbanan:

| LED | Betyder | Vad du gör |
|---|---|---|
| **Blinkande rött** | Försöker gå med i det sparade nätverket | Vänta — den blinkar en gång per anslutningsförsök, ungefär var 2,4 s |
| **Gult** | På nätverket, serverar inte ännu | Normalt osynligt (~24 ms). Om det *förblir* gult är WiFi i sin ordning och HTTP-servern är felet |
| **Grönt** | Serverar | Normalt driftläge — [gå och hitta den](connecting.md#finding-the-device) |

Blinkande rött i några sekunder vid varje uppstart är väntat; att gå med i ett
nätverk går inte på nolltid. Det är bara ett problem om det inte tar slut.

## En enhet som inte gör det { #a-device-that-does-not }

Ett kort som aldrig har konfigurerats, eller som flyttats någonstans där dess
sparade nätverk inte finns, får slut på försök och erbjuder i stället ett eget
nätverk:

| LED | Betyder | Vad du gör |
|---|---|---|
| **Blinkande rött** | Försöker, och misslyckas, gå med | Vänta tills den ger upp — det gör den |
| **Blått** | Installationsportalen på dess egen accesspunkt | [Gå med i den och konfigurera ett nätverk](connecting.md#the-setup-portal) |

När portalen har sparat ett nätverk startar enheten om och kör den första
sekvensen i stället: blinkande rött, sedan grönt.

**Fast rött** hör inte till någon av dem: det betyder att enheten gav upp
*och* inte startade portalen. Det är ett fel snarare än ett läge att agera på
— se [Felsökning](troubleshooting.md).

## Vitt — du håller knappen intryckt { #white-you-are-holding-the-button }

**Vitt** är inte ett läge enheten hamnar i av sig själv. Det dyker upp tre
sekunder in i ett tryck på **BOOT**-knappen och betyder att enheten räknar mot
en [fabriksåterställning](connecting.md#moving-the-device-to-a-different-network).

Släpp, så går den tillbaka till den färg den visade. Håll kvar till tio
sekunder, så startar den om och har glömt varje nätverk den känner till.

Om du ser vitt och inte menade det, släpp — inget har hänt ännu.

Om lampan blir vit **av sig själv**, utan att någon rör knappen, är knappen
fastklämd eller kortsluten. Enheten märker det — den vägrar agera på en knapp
den aldrig har sett släppas, så den återställer inte sig själv — men knappen
fungerar inte förrän felet är åtgärdat. Den seriella loggen säger det rakt ut.

## Tre saker värda att säga, för ingen av dem går att gissa { #three-things-worth-saying-because-none-is-guessable }

- **Blinkande kontra fast rött är den viktiga skillnaden.** Före
  [#122](https://github.com/Malmo-Skyttegille-Pistolsektionen/revolve_now/issues/122)
  var båda fasta, så "håller fortfarande på att starta" och "gick aldrig med"
  såg likadana ut — vilket är precis den fråga du har på skjutbanan.
- **Gult är en felindikator, inte ett steg.** Det finns för att synas bara när
  något är fel.
- **Vitt är den enda färgen som svarar dig i stället för att rapportera om
  enheten.** Varje annan färg är något att läsa av; vitt är återkoppling på
  något du gör med den just nu.

Lampan är avsiktligt svag: enheten står på en skjutbana i mörker, och en stark
indikator distraherar framför skjutlinjen. Fotografier till den här
dokumentationen bör tas i svagt ljus, annars syns inte färgerna ovan som de
beskrivs.

<!-- TODO: low-light photographs of each LED state, per the note above -->

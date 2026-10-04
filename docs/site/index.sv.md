# ![Revolve Now](img/revolve-now-logo-light.svg#only-light){ width="320" } ![Revolve Now](img/revolve-now-logo-dark.svg#only-dark){ width="320" }

Programvara för att köra tidsstyrda skjutprogram på en vändtavleanläggning,
byggd av och för Malmö Skyttegille Pistolsektionen.

Ett ESP32-S3-kort vänder tavlorna fram och bort enligt ett skjutprogram och
spelar upp de inlästa eldkommandona genom en förstärkare. En webbapp i React —
som kortet självt serverar över WiFi — startar och stoppar program, följer
körningen live och hanterar de lagrade programmen och ljuden.

Kortet talar inget tavelsystems eget protokoll: det sluter och bryter en enda
krets, och tavelanläggningens egen elektronik sköter resten. Det byggdes mot
[Eigenbrod TP2](https://eigenbrod-schiessanlagen.de/en/products?tx_produkt_produkte%5Baction%5D=show&tx_produkt_produkte%5BL%5D=2&tx_produkt_produkte%5Bprodukt%5D=319&cHash=942340d5971be0a0ac3d26ff3c257c0b), men
allt som styrs på samma sätt — en kontaktslutning, nivåstyrd, två lägen — bör
fungera.

!!! danger "Säkerhetsvarning — läs innan du installerar eller använder"

    **Den här enheten flyttar stål på en skarp skjutbana, och den gör det på
    en timer.** En tavla vänds för att ett program sa att det var dags, inte
    för att den kan se vem som står framför den. Den har ingen aning om att
    någon är framför skjutlinjen.

    - **Skjutbanans egna säkerhetsregler och eldkommandon styr skjutlinjen.
      Den här programvaran styr ingenting.** Ett program som kör betyder inte
      att banan är skarp; ett program som stoppats betyder inte att banan är
      säker.
    - **Gå aldrig fram till tavlorna för att webbappen säger att körningen
      är klar.** Bekräfta eld upphör på det sätt din skjutbana redan kräver —
      muntligt, med vapnen tömda och avlagda.
    - **En tavla som vänds kan skada den som står bredvid den.** Håll dig
      undan från mekanismen så länge enheten är strömsatt.

    **Lita inte på att den här programvaran skyddar någon.** Den är en
    bekvämlighet för att köra program, inte en säkerhetsanordning: inget
    förreglingsskydd, ingen sensor och inget sätt att veta var folk befinner
    sig.

    Projektet tillhandahålls i befintligt skick utan någon som helst garanti.
    Upphovspersonerna tar inget ansvar för personskada, sakskada eller förlust
    som följer av att bygga, installera, ändra eller använda systemet.

Tavlorna vilar framvända och stannar så vid uppstart, med avsikt: någon kan
befinna sig framför skjutlinjen när ett kort strömsätts, och en tavla som vänds
av sig själv kan skada den personen. Viloläget kan ändras för en tavelanläggning
som är kopplad tvärtom, men bara över en seriekabel — se
[Inställningar](settings.md).

## Var ska jag börja { #where-to-start }

- [Hårdvara och inkoppling](hardware.md) — DB9-kontakten och vad en
  tavelanläggning måste klara för att fungera med kortet.
- [Ansluta](connecting.md) — gå med i enhetens nätverk och öppna webbappen.
- [Köra ett program](running-a-program.md) — starta, följa och stoppa en
  körning.
- [Statuslampan](status-led.md) — vad enheten försöker säga när ingen har en
  webbläsare öppen.
- [Felsökning](troubleshooting.md) — vanliga problem och vad du kan
  kontrollera.

## Programredigeraren { #program-editor }

[**Öppna programredigeraren**](editor/){ .md-button } — skriv och redigera
program i en webbläsare **utan någon enhet ansluten**, ladda sedan ner filen
eller öppna en pull request. Också det enklaste sättet att läsa ett
medföljande program utan ett kort framför dig.

## Skriv ett program utan enhet { #write-a-program-without-a-device }

**[Programredigeraren](https://malmo-skyttegille-pistolsektionen.github.io/revolve_now/editor/)** körs helt i en webbläsarflik, utan något kort
anslutet. Öppna ett program från det här repot, redigera det och ladda antingen
ner filen eller öppna en pull request med den. [Skriva ett eget
program](writing-a-program.md) går igenom hur man bygger ett från grunden.

## Källkod { #source }

Den fullständiga tekniska dokumentationen — inkoppling av hårdvaran,
API-kontraktet samt firmwarens och webbappens inre — finns i
[repot](https://github.com/Malmo-Skyttegille-Pistolsektionen/revolve_now).

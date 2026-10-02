import bannerUrl from '../assets/home-banner.jpg'
import { icon } from '../lib/dom.js'
import { showHelp } from './help.js'

const NEWS = [
  ['Web Portal Update', '08/04/2026', 'This demo portal recreates the announcement layout. No production guidance or actions apply here.'],
  ['Web Portal Maintenance', '08/03/2026', 'Demo maintenance notice. The synthetic environment remains available.'],
  ['Web Portal Update', '07/29/2026', 'Explore synthetic authorizations, claims, members, and provider records using the navigation above.'],
  ['Annual Provider Training', '06/15/2026', 'Synthetic training announcement for demonstration only.'],
]

export async function renderHome({ main }) {
  main.innerHTML = `<article class="card home-card"><h2>MedPOINT Management Provider Portal</h2>
      <img class="hero" src="${bannerUrl}" alt="Public portal banner showing healthcare professionals">
      <div class="home-copy"><p>Welcome to the MedPOINT Provider Web Portal!</p>
        <p>Our goal with this website is to provide you with a fresh-modern look, easy to access information and improved process efficiency throughout the site.</p>
        <p>View our guides for help:</p><p><a href="#/forms">User Guide</a></p>
        <p>For any questions, suggestions, feedback or comments, please <button type="button" class="text-button inline" data-help>e-mail us.</button></p>
        <p>Thank You!<br>The Web Portal Team</p></div></article>
    <article class="card"><h2>News and Updates</h2>${NEWS.map(([title, date, text]) => `<section class="news"><h3>${title}</h3><time>${date}</time><p>${text}</p>
      <button type="button" class="text-button" data-help>${icon('description')}Read More...</button></section>`).join('')}</article>`
  main.querySelectorAll('[data-help]').forEach((button) => button.addEventListener('click', showHelp))
}

export const metadata = {
  title: "Termos de Uso — PostarIG",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-ig-text">
      <h1 className="mb-6 text-2xl font-bold text-ig-text">Termos de Uso</h1>
      <p className="mb-4 text-sm text-ig-muted">Última atualização: junho de 2026</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <p>
          Estes Termos regem o uso do PostarIG (&quot;postarigr.vercel.app&quot;), ferramenta de
          agendamento e publicação de conteúdo para Instagram e TikTok.
        </p>

        <h2 className="text-lg font-semibold text-ig-text">1. Aceitação</h2>
        <p>
          Ao usar o PostarIG, você concorda com estes Termos e com nossa{" "}
          <a href="/privacy" className="text-ig-primary underline">
            Política de Privacidade
          </a>
          .
        </p>

        <h2 className="text-lg font-semibold text-ig-text">2. Serviço</h2>
        <p>
          O PostarIG permite conectar contas Instagram e TikTok, enviar vídeos, gerar legendas
          com IA e agendar publicações. Você é responsável pelo conteúdo publicado e pela
          conformidade com as regras de cada plataforma.
        </p>

        <h2 className="text-lg font-semibold text-ig-text">3. Conta e acesso</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Você deve ter autorização para gerenciar as contas conectadas.</li>
          <li>Tokens de acesso são usados apenas para publicar em seu nome.</li>
          <li>Você pode revogar o acesso a qualquer momento nas configurações do Instagram/TikTok.</li>
        </ul>

        <h2 className="text-lg font-semibold text-ig-text">4. Uso permitido</h2>
        <p>
          É proibido usar o serviço para conteúdo ilegal, spam, violação de direitos autorais ou
          qualquer uso que viole os termos da Meta, TikTok ou leis aplicáveis.
        </p>

        <h2 className="text-lg font-semibold text-ig-text">5. Limitação de responsabilidade</h2>
        <p>
          O PostarIG é fornecido &quot;como está&quot;. Não garantimos publicação ininterrupta,
          pois dependemos de APIs de terceiros (Meta, TikTok, hospedagem).
        </p>

        <h2 className="text-lg font-semibold text-ig-text">6. Contato</h2>
        <p>
          Dúvidas:{" "}
          <a href="mailto:silvanianamauricio9@gmail.com" className="text-ig-primary underline">
            silvanianamauricio9@gmail.com
          </a>
        </p>
      </section>

      <p className="mt-8">
        <a href="/" className="text-sm text-ig-primary hover:underline">
          ← Voltar ao PostarIG
        </a>
      </p>
    </main>
  );
}

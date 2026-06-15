export const metadata = {
  title: "Política de Privacidade — PostarIG",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-zinc-300">
      <h1 className="mb-6 text-2xl font-bold text-white">Política de Privacidade</h1>
      <p className="mb-4 text-sm text-zinc-400">Última atualização: junho de 2026</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <p>
          O PostarIG (&quot;postarigr.vercel.app&quot;) é uma ferramenta de agendamento de
          conteúdo para Instagram. Esta política descreve como tratamos seus dados.
        </p>

        <h2 className="text-lg font-semibold text-white">Dados que coletamos</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Informações da conta Instagram conectada (nome de usuário, ID, foto de perfil)</li>
          <li>Tokens de acesso fornecidos pela Meta para publicar em seu nome</li>
          <li>Vídeos e legendas que você envia para agendamento</li>
          <li>Dados de sessão necessários para manter você logado no painel</li>
        </ul>

        <h2 className="text-lg font-semibold text-white">Como usamos os dados</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Agendar e publicar posts no Instagram conforme você solicita</li>
          <li>Gerar legendas com IA quando você usa o modo automático</li>
          <li>Exibir status de publicação e relatórios da sua conta</li>
        </ul>

        <h2 className="text-lg font-semibold text-white">Compartilhamento</h2>
        <p>
          Seus dados são compartilhados apenas com a Meta/Instagram (para publicação) e com
          provedores de infraestrutura (hospedagem e banco de dados). Não vendemos seus dados.
        </p>

        <h2 className="text-lg font-semibold text-white">Exclusão de dados</h2>
        <p>
          Para remover seus dados, desconecte sua conta Instagram no painel ou envie solicitação
          para:{" "}
          <a href="mailto:silvanianamauricio9@gmail.com" className="text-pink-400 underline">
            silvanianamauricio9@gmail.com
          </a>
          . Você também pode revogar o acesso em Configurações do Instagram → Apps e sites.
        </p>

        <h2 className="text-lg font-semibold text-white">Contato</h2>
        <p>
          Dúvidas:{" "}
          <a href="mailto:silvanianamauricio9@gmail.com" className="text-pink-400 underline">
            silvanianamauricio9@gmail.com
          </a>
        </p>
      </section>

      <p className="mt-8">
        <a href="/" className="text-sm text-pink-400 hover:underline">
          ← Voltar ao PostarIG
        </a>
      </p>
    </main>
  );
}
